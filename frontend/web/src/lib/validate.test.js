import { describe, expect, it } from "vitest";
import { emptyForm, getIn, mergeDraft, setIn } from "./form.js";
import { toPayload } from "./storage.js";
import { validate } from "./validate.js";

const WALLET = "0x7a3f00000000000000000000000000000000c209";

function validForm() {
  let d = emptyForm();
  const put = (p, v) => (d = setIn(d, p, v));
  put("team.name", "Night Owls");
  put("project.name", "Atlas");
  put("project.pitch", "Turn a 40-page report into a 2-minute flow");
  put("project.description", "Next.js + Foundry. Analysts upload reports, we summarise them.");
  put("code.repoUrl", "https://github.com/night-owls/atlas");
  put("demo.videoUrl", "https://youtu.be/abc");
  return d;
}

const errs = (d, walletAddress = WALLET) => validate(d, { walletAddress }).errors;

describe("validate", () => {
  it("accepts a complete form with a connected wallet", () => {
    expect(errs(validForm())).toEqual({});
  });

  it("requires every text field", () => {
    expect(Object.keys(errs(emptyForm()))).toEqual([
      "team.name",
      "project.name",
      "project.pitch",
      "project.description",
      "code.repoUrl",
      "demo.videoUrl",
    ]);
  });

  it("needs a connected wallet, reported separately from fields", () => {
    expect(errs(validForm(), "")).toEqual({ wallet: expect.any(String) });
  });

  it("enforces character limits", () => {
    expect(errs(setIn(validForm(), "project.pitch", "x".repeat(141)))["project.pitch"]).toMatch(/140/);
  });

  it("allows zero to three tracks and rejects a fourth", () => {
    expect(errs(setIn(validForm(), "tracks.selected", ["base", "ens", "world"]))).toEqual({});
    expect(errs(setIn(validForm(), "tracks.selected", ["base", "ens", "world", "polygon"]))["tracks.selected"]).toMatch(/at most 3/);
  });

  it("rejects tracks not on the event list", () => {
    expect(errs(setIn(validForm(), "tracks.selected", ["made-up"]))["tracks.selected"]).toMatch(/isn't on this event's list/);
  });

  it("only accepts GitHub repo URLs", () => {
    for (const bad of ["https://gitlab.com/a/b", "github.com/a/b", "https://github.com/a", "http://github.com/a/b"]) {
      expect(errs(setIn(validForm(), "code.repoUrl", bad)), bad).toHaveProperty("code.repoUrl");
    }
  });

  it("needs an https demo video link", () => {
    expect(errs(setIn(validForm(), "demo.videoUrl", "http://youtu.be/x"))["demo.videoUrl"]).toMatch(/https/);
  });
});

describe("form helpers", () => {
  it("setIn is immutable", () => {
    const a = emptyForm();
    const b = setIn(a, "team.name", "X");
    expect(getIn(b, "team.name")).toBe("X");
    expect(a.team.name).toBe("");
  });

  it("mergeDraft keeps known fields and drops ones the form no longer has", () => {
    const merged = mergeDraft({ team: { name: "Old", members: [1] }, tracks: { selected: ["base"] }, consent: true });
    expect(merged.team).toEqual({ name: "Old" });
    expect(merged.tracks.selected).toEqual(["base"]);
    expect(merged).not.toHaveProperty("consent");
  });
});

describe("fixtures", () => {
  it("the Go Health Me fixture is a valid submission", async () => {
    const { readFile } = await import("node:fs/promises");
    const url = new URL("../../../../backend/fixtures/go-health-me/submission.json", import.meta.url);
    const { form } = JSON.parse(await readFile(url, "utf8"));
    expect(errs(mergeDraft(form))).toEqual({});
  });
});

describe("toPayload", () => {
  it("uses the connected wallet as owner and reward wallet", () => {
    const p = toPayload(setIn(validForm(), "code.repoUrl", "https://github.com/night-owls/atlas/"), { ownerWallet: WALLET, chainId: 84532 });
    expect(p.ownerWallet).toBe(WALLET);
    expect(p.rewardWallet).toBe(WALLET);
    expect(p.repoUrl).toBe("https://github.com/night-owls/atlas");
  });
});
