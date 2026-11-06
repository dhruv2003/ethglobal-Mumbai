import { describe, expect, it } from "vitest";
import { setIn } from "./form.js";
import { toPayload } from "./storage.js";
import { validate } from "./validate.js";
import { embedUrl, isUploadRef, linkPlan, uploadUrl } from "./video.js";
import { emptyForm } from "./form.js";

const REF = `upload:${"ab".repeat(32)}.mp4`;

describe("demo video links", () => {
  it("embeds YouTube, Loom, Vimeo and Google Drive; nothing else", () => {
    expect(embedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://www.youtube.com/watch?v=abc")).toBe("https://www.youtube-nocookie.com/embed/abc");
    expect(embedUrl("https://www.loom.com/share/17b1dc5da755422ea3177d4842556813")).toBe("https://www.loom.com/embed/17b1dc5da755422ea3177d4842556813");
    expect(embedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(embedUrl("https://drive.google.com/file/d/1AbC/view?usp=sharing")).toBe("https://drive.google.com/file/d/1AbC/preview");
    expect(embedUrl("https://cdn.example/demo.mp4")).toBeNull();
    expect(embedUrl("http://youtu.be/x")).toBeNull();
  });
  it("says what happens to each link", () => {
    expect(linkPlan("https://www.loom.com/share/abc")).toMatch(/save a copy/);
    expect(linkPlan("https://youtu.be/x")).toMatch(/can't save a copy/);
    expect(linkPlan("https://cdn.example/demo.mp4")).toMatch(/save a copy/);
    expect(linkPlan("nope")).toBeNull();
  });
  it("recognises only well-formed upload refs", () => {
    expect(isUploadRef(REF)).toBe(true);
    expect(uploadUrl(REF)).toBe(`/api/uploads/${"ab".repeat(32)}.mp4`);
    expect(isUploadRef("upload:../../x.mp4")).toBe(false);
    expect(uploadUrl("https://x")).toBeNull();
  });
});

describe("uploaded demo video in the form", () => {
  const base = () => setIn(emptyForm(), "demo.source", "upload");
  it("needs a finished upload when 'Upload a file' is chosen", () => {
    expect(validate(base()).errors["demo.videoUrl"]).toMatch(/Upload your demo video/);
    const done = setIn(base(), "demo.upload", { ref: REF, name: "demo.mp4", bytes: 10, seconds: 3 });
    expect(validate(done).errors["demo.videoUrl"]).toBeUndefined();
  });
  it("sends the upload ref as demoVideoUrl, and the link otherwise", () => {
    let d = setIn(base(), "demo.upload", { ref: REF });
    d = setIn(d, "demo.videoUrl", "https://youtu.be/old");
    expect(toPayload(d, { ownerWallet: "0x1", chainId: 1 }).demoVideoUrl).toBe(REF);
    d = setIn(d, "demo.source", "link");
    expect(toPayload(d, { ownerWallet: "0x1", chainId: 1 }).demoVideoUrl).toBe("https://youtu.be/old");
  });
});

describe("screenshots instead of a video", () => {
  const IMG = `upload:${"cd".repeat(32)}.png`;
  const base = () => setIn(emptyForm(), "demo.source", "images");
  it("needs at least one uploaded screenshot", () => {
    expect(validate(base()).errors["demo.videoUrl"]).toMatch(/screenshot/);
    expect(validate(setIn(base(), "demo.images", [{ ref: IMG }])).errors["demo.videoUrl"]).toBeUndefined();
  });
  it("sends the screenshot refs and no video", () => {
    let d = setIn(base(), "demo.images", [{ ref: IMG }]);
    d = setIn(d, "demo.videoUrl", "https://youtu.be/old");
    const p = toPayload(d, { ownerWallet: "0x1", chainId: 1 });
    expect(p.demoVideoUrl).toBe("");
    expect(p.demoImages).toEqual([IMG]);
    expect(toPayload(setIn(d, "demo.source", "link"), { ownerWallet: "0x1", chainId: 1 }).demoImages).toEqual([]);
  });
  it("turns image refs into URLs, and nothing else", () => {
    expect(uploadUrl(IMG)).toBe(`/api/uploads/${"cd".repeat(32)}.png`);
    expect(uploadUrl(`upload:${"cd".repeat(32)}.svg`)).toBeNull();
  });
});
