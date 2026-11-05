import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkSubmissionSignature, requireOrganizer, submissionDigest } from "../src/security.mjs";

// A fresh random wallet for every run; nothing is stored or funded.
const account = privateKeyToAccount(generatePrivateKey());

async function signed(overrides = {}) {
  const body = {
    team: { name: "Night Owls" },
    project: { name: "Atlas", pitch: "Reports in 2 minutes", description: "Next.js + Foundry." },
    repoUrl: "https://github.com/team/atlas",
    demoVideoUrl: "https://youtu.be/x",
    tracks: ["base"],
    ownerWallet: account.address,
    fighterSeed: "abc123",
  };
  const issuedAt = overrides.issuedAt ?? new Date().toISOString();
  const message = [
    `Submit "${body.project.name}" to ETHGlobal Mumbai Battle Arena`,
    `Repository: ${body.repoUrl}`,
    `Owner: ${account.address}`,
    `Submission: ${submissionDigest(body)}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
  const signature = await account.signMessage({ message });
  return { ...body, auth: { message, signature, issuedAt } };
}

test("a correctly signed submission passes", async () => {
  assert.equal(await checkSubmissionSignature(await signed()), null);
});

test("a submission claiming someone else's wallet fails", async () => {
  const s = await signed();
  s.ownerWallet = "0x7a3f4c2e9b1d00000000000000000000a1b2c209";
  assert.match(await checkSubmissionSignature(s), /doesn't match|wasn't made/);
});

test("changing the repo after signing fails", async () => {
  const s = await signed();
  s.repoUrl = "https://github.com/someone/else";
  assert.match(await checkSubmissionSignature(s), /doesn't match/);
});

test("old signatures are refused", async () => {
  const s = await signed({ issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  assert.match(await checkSubmissionSignature(s), /too old/);
});

test("a fresh unsigned timestamp can't revive an old signature", async () => {
  const s = await signed({ issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  s.auth.issuedAt = new Date().toISOString(); // attacker edits the unsigned field
  assert.match(await checkSubmissionSignature(s), /too old/);
});

test("editing any field after signing fails (pitch, tracks...)", async () => {
  const a = await signed();
  a.project.pitch = "Something else";
  assert.match(await checkSubmissionSignature(a), /doesn't match/);
  const b = await signed();
  b.tracks = ["ens"];
  assert.match(await checkSubmissionSignature(b), /doesn't match/);
});

test("a signature works once", async () => {
  const s = await signed();
  assert.equal(await checkSubmissionSignature(s), null);
  assert.match(await checkSubmissionSignature(s), /already used/);
});

test("missing signature is refused", async () => {
  assert.match(await checkSubmissionSignature({ project: { name: "x" }, repoUrl: "r", ownerWallet: account.address }), /Missing/);
});

function run(mw, { ip = "127.0.0.1", auth, forwarded } = {}) {
  let status = 200;
  let nextCalled = false;
  const req = { socket: { remoteAddress: ip }, get: (h) => (h === "authorization" ? auth : h === "x-forwarded-for" ? forwarded : undefined) };
  const res = { status: (s) => ((status = s), res), json: () => res };
  mw(req, res, () => (nextCalled = true));
  return nextCalled ? "next" : status;
}

test("organizer routes: no ADMIN_TOKEN fails closed", () => {
  delete process.env.ADMIN_TOKEN;
  delete process.env.ALLOW_LOCAL_ORGANIZER;
  assert.equal(run(requireOrganizer, { ip: "127.0.0.1" }), 403);
  assert.equal(run(requireOrganizer, { ip: "203.0.113.9" }), 403);
});

test("organizer routes: local opt-in only for direct, non-proxied localhost", () => {
  delete process.env.ADMIN_TOKEN;
  process.env.ALLOW_LOCAL_ORGANIZER = "1";
  assert.equal(run(requireOrganizer, { ip: "127.0.0.1" }), "next");
  assert.equal(run(requireOrganizer, { ip: "127.0.0.1", forwarded: "203.0.113.9" }), 403);
  assert.equal(run(requireOrganizer, { ip: "203.0.113.9" }), 403);
  delete process.env.ALLOW_LOCAL_ORGANIZER;
});

test("organizer routes: with ADMIN_TOKEN the right key is required, from anywhere", () => {
  const organizer = crypto.randomUUID(); // made up per run
  process.env.ADMIN_TOKEN = organizer;
  assert.equal(run(requireOrganizer, { ip: "127.0.0.1" }), 401);
  assert.equal(run(requireOrganizer, { ip: "203.0.113.9", auth: "Bearer wrong" }), 401);
  assert.equal(run(requireOrganizer, { ip: "203.0.113.9", auth: `Bearer ${organizer}` }), "next");
  delete process.env.ADMIN_TOKEN;
});
