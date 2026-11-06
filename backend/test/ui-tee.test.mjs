import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import agents from "../src/agents/index.js";
import zg from "../src/zg/client.js";
import tee from "../src/zg/tee.js";

// ---------- UI face-off: no quantity bias ----------

const img = (id, kind) => ({ id, kind, label: kind, image: Buffer.from("x"), mime: "image/jpeg" });

test("both sides are trimmed to the same number of images, keeping the mix of kinds", () => {
  const a = [img("A1", "team"), img("A2", "video"), img("A3", "video"), img("A4", "live"), img("A5", "live")];
  assert.deepEqual(agents.trimImages(a, 3).map((x) => x.id), ["A1", "A2", "A4"]);
  assert.equal(agents.trimImages(a, 9).length, 5);
});

test("an issue that only says a screen wasn't shown is dropped; real defects stay", () => {
  const kept = agents.dropUnshown([
    { detail: "No sign-in or onboarding screens shown.", severity: 3 },
    { detail: "No phone layout shown; cannot assess mobile usability.", severity: 1 },
    { detail: "Approve button hidden behind the keyboard on the phone.", severity: 3 },
  ]);
  assert.deepEqual(kept.map((x) => x.detail), ["Approve button hidden behind the keyboard on the phone."]);
});

test("personal data copied out of a screenshot is masked; dates and counts are not", () => {
  assert.equal(agents.maskPii("user a.b+1@mail.example.com, 0xf4FB8d2bD856e672b5f9848b0eD235A20079B250, +91 98765 43210, on 9/27/2026, 3 runs"), "user [email], [wallet], [number], on 9/27/2026, 3 runs");
});

test("the edge comes from the two independent ratings: a 1-point gap is even", () => {
  const s = (quality) => ({ quality, strengths: ["clear"], issues: [] });
  const names = { A: "Alpha", B: "Beta" };
  assert.equal(agents.uiVerdict(names, s(7), s(8)).edge, "even");
  assert.equal(agents.uiVerdict(names, s(8), s(6)).edge, "A");
  assert.equal(agents.uiVerdict(names, s(4), s(7)).edge, "B");
  assert.equal(agents.uiVerdict(names, s(9), { quality: null, strengths: [], issues: [] }).edge, "even");
});

test("compareUi assesses each project in its own call, never showing it the other side", async () => {
  const realChat = zg.chatJSON;
  const calls = [];
  zg.chatJSON = async ({ messages }) => {
    const text = messages[1].content.map((c) => c.text ?? "").join(" ");
    calls.push(text);
    const isA = text.includes("Alpha");
    return { data: { screens: "s", strengths: ["ok"], issues: [{ detail: "No settings screen shown.", severity: 2, images: [] }], demoMatchesLive: "unclear", quality: isA ? 8 : 7 }, trace: { requestId: isA ? "a" : "b" }, traces: [{ requestId: isA ? "a" : "b" }] };
  };
  try {
    const r = await agents.compareUi({ names: { A: "Alpha", B: "Beta" }, images: { A: [img("A1", "team"), img("A2", "video"), img("A3", "live")], B: [img("B1", "team")] } });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((t) => !(t.includes("Alpha") && t.includes("Beta"))), "a call saw both projects");
    assert.deepEqual(r.sent, { A: 1, B: 1 });
    assert.equal(r.edge, "even"); // 8 vs 7
    assert.deepEqual(r.A.issues, []); // "not shown" filtered
    assert.equal(r.traces.length, 2);
  } finally {
    zg.chatJSON = realChat;
  }
});

// ---------- independent TEE signature check ----------

const signer = privateKeyToAccount(generatePrivateKey());
const svc = (over = {}) => ({ url: "https://provider.example", model: "M", verifiability: "TeeML", additionalInfo: '{"TargetSeparated":false}', teeSignerAddress: signer.address, teeSignerAcknowledged: true, ...over });
const sigFetch = (text, signature) => async () => ({ ok: true, status: 200, json: async () => ({ text, signature }) });
const trace = { provider: "0xf4FB8d2bD856e672b5f9848b0eD235A20079B250", chatId: "chat-1" };

test("a signature from the on-chain TEE signer verifies", async () => {
  const text = "zg-sig-v1/e2ee-ct:aa:bb";
  const r = await tee.verifyChat(trace, { read: async () => svc(), fetchImpl: sigFetch(text, await signer.signMessage({ message: text })) });
  assert.equal(r.teeVerified, true);
  assert.equal(r.teeCheck, "signature");
});

test("a signature from anyone else fails, and a missing one is null (never true)", async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  const text = "zg-sig-v1/e2ee-ct:aa:bb";
  const bad = await tee.verifyChat(trace, { read: async () => svc(), fetchImpl: sigFetch(text, await other.signMessage({ message: text })) });
  assert.equal(bad.teeVerified, false);
  const down = await tee.verifyChat(trace, { read: async () => svc(), fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(down.teeVerified, null);
  const unacked = await tee.verifyChat(trace, { read: async () => svc({ teeSignerAcknowledged: false }), fetchImpl: sigFetch(text, "0x") });
  assert.equal(unacked.teeVerified, false);
  assert.equal((await tee.verifyChat({ provider: null }, {})).teeVerified, null);
});

test("a separated provider is checked against the model's own TEE address", () => {
  const info = JSON.stringify({ TargetSeparated: true, TargetTeeAddress: "0x1111111111111111111111111111111111111111" });
  assert.equal(tee.signerOf(svc({ additionalInfo: info })), "0x1111111111111111111111111111111111111111");
  assert.equal(tee.signerOf(svc({ additionalInfo: JSON.stringify({ TargetSeparated: true, TargetTeeAddress: "0x1111111111111111111111111111111111111111", ProviderType: "centralized" }) })), signer.address);
});

test("a non-https provider URL is refused", async () => {
  const r = await tee.verifyChat(trace, { read: async () => svc({ url: "http://provider.example" }), fetchImpl: sigFetch("x", "0x") });
  assert.equal(r.teeVerified, null);
  assert.match(r.teeReason, /https/);
});
