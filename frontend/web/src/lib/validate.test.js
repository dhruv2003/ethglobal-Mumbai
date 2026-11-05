import { describe, expect, it } from "vitest";
import { emptyForm, getIn, mergeDraft, setIn } from "./form.js";
import { toPayload } from "./storage.js";
import { validate } from "./validate.js";

const WALLET = "0x7a3f00000000000000000000000000000000c209";

function validForm() {
  let d = emptyForm();
  const put = (p, v) => (d = setIn(d, p, v));
  put("team.name", "Night Owls");
  put("team.members.0.name", "Dhruv");
  put("project.name", "Atlas");
  put("project.pitch", "Turn a 40-page report into a 2-minute flow");
  put("project.problem", "Reports are long");
  put("project.users", "Analysts");
  put("project.howItsMade", "Next.js + Foundry");
  put("project.builtAtEvent", "yes");
  put("code.repoUrl", "https://github.com/night-owls/atlas");
  put("demo.videoUrl", "https://youtu.be/abc");
  put("consent", true);
  return d;
}

describe("validate", () => {
  it("accepts a complete form with a connected wallet", () => {
    expect(validate(validForm(), { walletAddress: WALLET }).errors).toEqual({});
  });

  it("requires a connected wallet as team owner", () => {
    expect(validate(validForm()).errors).toHaveProperty("team.ownerWallet");
  });

  it("allows zero to three tracks and rejects a fourth", () => {
    let d = validForm();
    expect(validate(d, { walletAddress: WALLET }).errors).toEqual({});
    d = setIn(d, "tracks.selected", ["base", "ens", "world"]);
    d = setIn(d, "tracks.justification", { base: "x", ens: "y", world: "z" });
    expect(validate(d, { walletAddress: WALLET }).errors).toEqual({});
    d = setIn(d, "tracks.selected", ["base", "ens", "world", "polygon"]);
    expect(validate(d, { walletAddress: WALLET }).errors["tracks.selected"]).toMatch(/at most 3/);
  });

  it("requires a justification for each selected track", () => {
    const d = setIn(validForm(), "tracks.selected", ["base"]);
    expect(validate(d, { walletAddress: WALLET }).errors).toHaveProperty("tracks.justification.base");
  });

  it("rejects tracks not on the event list", () => {
    let d = setIn(validForm(), "tracks.selected", ["made-up"]);
    d = setIn(d, "tracks.justification", { "made-up": "x" });
    expect(validate(d, { walletAddress: WALLET }).errors["tracks.selected"]).toMatch(/isn't on this event's list/);
  });

  it("only accepts GitHub repo URLs", () => {
    for (const bad of ["https://gitlab.com/a/b", "github.com/a/b", "https://github.com/a", "http://github.com/a/b"]) {
      const d = setIn(validForm(), "code.repoUrl", bad);
      expect(validate(d, { walletAddress: WALLET }).errors, bad).toHaveProperty("code.repoUrl");
    }
  });

  it("checks contract addresses and networks", () => {
    const d = setIn(validForm(), "code.contracts", [{ id: "a", address: "0x123", network: "" }]);
    const { errors } = validate(d, { walletAddress: WALLET });
    expect(errors).toHaveProperty("code.contracts.0.address");
    expect(errors).toHaveProperty("code.contracts.0.network");
  });

  it("needs a demo video as a link or a file", () => {
    let d = setIn(validForm(), "demo.videoUrl", "");
    expect(validate(d, { walletAddress: WALLET }).errors).toHaveProperty("demo.video");
    d = setIn(d, "demo.videoFile", { name: "demo.mp4", size: 1000, duration: 150 });
    expect(validate(d, { walletAddress: WALLET }).errors).toEqual({});
  });

  it("warns (not errors) when the video is outside 2 to 4 minutes", () => {
    const d = setIn(validForm(), "demo.videoFile", { name: "demo.mp4", size: 1000, duration: 400 });
    const r = validate(d, { walletAddress: WALLET });
    expect(r.errors).toEqual({});
    expect(r.warnings["demo.video"]).toMatch(/6:40/);
  });

  it("needs a start date when the project wasn't built at the event", () => {
    let d = setIn(validForm(), "project.builtAtEvent", "no");
    expect(validate(d, { walletAddress: WALLET }).errors).toHaveProperty("project.startDate");
    d = setIn(d, "project.startDate", "2099-01-01");
    expect(validate(d, { walletAddress: WALLET, today: "2026-11-06" }).errors["project.startDate"]).toMatch(/future/);
  });

  it("enforces the 500 MB total across all files", () => {
    const big = { size: 200 * 1024 * 1024 };
    let d = setIn(validForm(), "demo.artifacts", [big, big, big]);
    expect(validate(d, { walletAddress: WALLET }).errors).toHaveProperty("demo.artifacts");
  });

  it("validates a different reward wallet only when chosen", () => {
    let d = setIn(validForm(), "team.rewardDifferent", true);
    expect(validate(d, { walletAddress: WALLET }).errors).toHaveProperty("team.rewardWallet");
    d = setIn(d, "team.rewardWallet", WALLET);
    expect(validate(d, { walletAddress: WALLET }).errors).toEqual({});
  });
});

describe("form helpers", () => {
  it("setIn is immutable and handles array indexes", () => {
    const a = emptyForm();
    const b = setIn(a, "team.members.0.name", "X");
    expect(getIn(b, "team.members.0.name")).toBe("X");
    expect(a.team.members[0].name).toBe("");
    expect(Array.isArray(b.team.members)).toBe(true);
  });

  it("mergeDraft fills in fields added after the draft was saved", () => {
    const merged = mergeDraft({ team: { name: "Old" }, tracks: { justification: { base: "hi" } } });
    expect(merged.team.name).toBe("Old");
    expect(merged.team.members).toHaveLength(1);
    expect(merged.tracks.justification.base).toBe("hi");
    expect(merged.demo.artifacts).toEqual([]);
  });
});

describe("toPayload", () => {
  it("defaults the reward wallet to the owner and strips browser-only fields", () => {
    let d = setIn(validForm(), "project.logo", { id: "1", name: "l.png", size: 5, type: "image/png", kind: "image", previewUrl: "blob:x" });
    d = setIn(d, "team.members.0.github", "@dhruv2003");
    const p = toPayload(d, { ownerWallet: WALLET, chainId: 84532 });
    expect(p.team.rewardWallet).toBe(WALLET);
    expect(p.team.members[0].github).toBe("dhruv2003");
    expect(p.project.logo).not.toHaveProperty("previewUrl");
    expect(p.code.ref).toBeNull();
  });
});
