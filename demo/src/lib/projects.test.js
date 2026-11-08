import { describe, expect, it } from "vitest";
import { embedUrl } from "./projects.js";
import { cleanName } from "./names.js";

describe("embedUrl", () => {
  it("embeds Loom and YouTube links", () => {
    expect(embedUrl("https://www.loom.com/share/abcdef0123")).toBe("https://www.loom.com/embed/abcdef0123");
    expect(embedUrl("https://youtu.be/xyz")).toBe("https://www.youtube-nocookie.com/embed/xyz");
  });

  it("returns null for anything else", () => {
    expect(embedUrl("https://example.com/video.mp4")).toBeNull();
    expect(embedUrl("not a url")).toBeNull();
  });
});

describe("cleanName", () => {
  it("reads a project name typed as a URL as a name", () => {
    expect(cleanName("https://app-studio.mozark.ai/")).toBe("App Studio");
    expect(cleanName("Go Health Me")).toBe("Go Health Me");
    expect(cleanName("")).toBe("Untitled");
  });
});
