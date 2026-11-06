import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { ACTION, claimStore, createClaims, worldVerifier } from "../src/world/claim.mjs";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

const proof = (over = {}, item = {}) => ({
  protocol_version: "4.0",
  environment: "staging",
  action: ACTION,
  nonce: "0xabc",
  responses: [{ identifier: "proof_of_human", issuer_schema_id: 1, nullifier: "12345", proof: ["1", "2", "3", "4", "5"], expires_at_min: 1, signal_hash: hashSignal(WALLET), ...item }],
  ...over,
});

function setup({ verify = async () => true, send = async () => "0xhash" } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "world-")), "claims.json");
  const sent = [];
  const store = claimStore(file);
  const claim = createClaims({
    environment: "staging",
    store,
    hashSignal,
    verifyProof: verify,
    sendFilter: async (wallet) => {
      const hash = await send(wallet);
      sent.push(wallet);
      return hash;
    },
  });
  return { claim, sent, store, file };
}
const refusedWith = (code) => (e) => e.code === code;

test("a verified human gets one pack, sent to the wallet the proof names", async () => {
  const { claim, sent } = setup();
  const result = await claim({ wallet: WALLET, idkitResponse: proof() });
  assert.equal(result.hash, "0xhash");
  assert.deepEqual(sent, [WALLET]);
});

test("the same human can't claim again with another wallet", async () => {
  const { claim, sent } = setup();
  await claim({ wallet: WALLET, idkitResponse: proof() });
  await assert.rejects(claim({ wallet: OTHER, idkitResponse: proof({}, { signal_hash: hashSignal(OTHER) }) }), refusedWith("already_claimed"));
  assert.equal(sent.length, 1);
});

test("a nullifier written differently is still the same human", async () => {
  const { claim, sent } = setup();
  await claim({ wallet: WALLET, idkitResponse: proof({}, { nullifier: "255" }) });
  await assert.rejects(claim({ wallet: OTHER, idkitResponse: proof({}, { nullifier: "0xff", signal_hash: hashSignal(OTHER) }) }), refusedWith("already_claimed"));
  assert.equal(sent.length, 1);
});

test("two claims at the same moment send only once", async () => {
  const { claim, sent } = setup();
  const results = await Promise.allSettled([claim({ wallet: WALLET, idkitResponse: proof() }), claim({ wallet: WALLET, idkitResponse: proof() })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(sent.length, 1);
});

test("a restart remembers who claimed", async () => {
  const { claim, file } = setup();
  await claim({ wallet: WALLET, idkitResponse: proof() });
  const reloaded = claimStore(file);
  assert.equal(reloaded.humanClaimed("12345"), true);
  assert.equal(reloaded.walletClaim(WALLET).hash, "0xhash");
});

test("a damaged record refuses to start instead of forgetting every claim", () => {
  const { file } = setup();
  fs.writeFileSync(file, "{ not json");
  assert.throws(() => claimStore(file));
});

test("World rejecting the proof sends nothing and reserves nothing", async () => {
  const { claim, sent, store } = setup({ verify: async () => false });
  await assert.rejects(claim({ wallet: WALLET, idkitResponse: proof() }), refusedWith("proof_rejected"));
  assert.equal(sent.length, 0);
  assert.equal(store.humanClaimed("12345"), false);
});

test("World being unreachable sends nothing", async () => {
  const { claim, sent } = setup({ verify: async () => { throw new Error("down"); } });
  await assert.rejects(claim({ wallet: WALLET, idkitResponse: proof() }), refusedWith("world_unreachable"));
  assert.equal(sent.length, 0);
});

test("a failed send frees the claim so they can try again", async () => {
  let fail = true;
  const { claim, sent } = setup({ send: async () => { if (fail) throw new Error("no gas"); return "0xhash"; } });
  await assert.rejects(claim({ wallet: WALLET, idkitResponse: proof() }), refusedWith("send_failed"));
  fail = false;
  await claim({ wallet: WALLET, idkitResponse: proof() });
  assert.equal(sent.length, 1);
});

for (const [name, wallet, bad, code] of [
  ["a proof made for another wallet", OTHER, proof(), "bad_proof"],
  ["a production proof on a staging server", WALLET, proof({ environment: "production" }), "bad_proof"],
  ["a proof for another action", WALLET, proof({ action: "something-else" }), "bad_proof"],
  ["an old World ID 3.0 proof", WALLET, proof({ protocol_version: "3.0" }), "bad_proof"],
  ["a weaker credential", WALLET, proof({}, { issuer_schema_id: 9303 }), "bad_proof"],
  ["a proof with no wallet bound to it", WALLET, proof({}, { signal_hash: undefined }), "bad_proof"],
  ["a malformed nullifier", WALLET, proof({}, { nullifier: "nope" }), "bad_proof"],
  ["two responses at once", WALLET, proof({ responses: [{}, {}] }), "bad_proof"],
  ["no proof", WALLET, undefined, "bad_proof"],
  ["a bad wallet", "not-a-wallet", proof(), "bad_wallet"],
]) {
  test(`refuses ${name}, before asking World or sending`, async () => {
    let asked = false;
    const { claim, sent } = setup({ verify: async () => { asked = true; return true; } });
    await assert.rejects(claim({ wallet, idkitResponse: bad }), refusedWith(code));
    assert.equal(asked, false);
    assert.equal(sent.length, 0);
  });
}

test("the verifier forwards the proof and needs success in the right environment", async () => {
  let call;
  const answer = (body, ok = true) => async (url, init) => {
    call = { url, body: JSON.parse(init.body) };
    return { ok, json: async () => body };
  };
  const make = (fetchFn) => worldVerifier({ rpId: "rp_1", environment: "staging", fetchFn });
  assert.equal(await make(answer({ success: true, environment: "staging" }))(proof()), true);
  assert.equal(call.url, "https://developer.world.org/api/v4/verify/rp_1");
  assert.deepEqual(call.body.responses, proof().responses);
  assert.equal(await make(answer({ success: true, environment: "production" }))(proof()), false);
  assert.equal(await make(answer({ success: false, environment: "staging" }))(proof()), false);
  assert.equal(await make(answer({}, false))(proof()), false);
});

test("the World package signs a request with a test key", () => {
  const signed = signRequest({ signingKeyHex: "0x" + "11".repeat(32), action: ACTION });
  assert.match(signed.sig, /^0x/);
  assert.ok(signed.expiresAt > signed.createdAt);
});
