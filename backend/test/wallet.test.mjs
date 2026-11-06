import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMessage, verifyTypedData } from "ethers";
import { createTestWallet, revertReason } from "../tester/wallet.mjs";
import { CONNECT_STEP, looksLikeDapp, toRunnerSteps } from "../src/reviewer/flows.mjs";

test("the test wallet only shares an account after the dapp asks for one", async () => {
  const w = createTestWallet();
  assert.deepEqual((await w.handle({ method: "eth_accounts" })).result, []);
  const r = await w.handle({ method: "eth_requestAccounts" });
  assert.deepEqual(r.result, [w.address]);
  assert.equal(w.connected, true);
  assert.deepEqual((await w.handle({ method: "eth_accounts" })).result, [w.address]);
  assert.equal((await w.handle({ method: "eth_chainId" })).result, "0x1");
});

test("it really signs messages and typed data, with its own throwaway key", async () => {
  const w = createTestWallet();
  await w.handle({ method: "eth_requestAccounts" });
  const msg = "app.example wants you to sign in with your Ethereum account:\n" + w.address;
  const hex = "0x" + Buffer.from(msg).toString("hex");
  const sig = (await w.handle({ method: "personal_sign", params: [hex, w.address] })).result;
  assert.equal(verifyMessage(msg, sig), w.address);
  const typed = {
    domain: { name: "App", version: "1", chainId: 1 },
    types: { EIP712Domain: [{ name: "name", type: "string" }], Vote: [{ name: "choice", type: "uint8" }] },
    primaryType: "Vote",
    message: { choice: 2 },
  };
  const sig2 = (await w.handle({ method: "eth_signTypedData_v4", params: [w.address, JSON.stringify(typed)] })).result;
  assert.equal(verifyTypedData(typed.domain, { Vote: typed.types.Vote }, typed.message, sig2), w.address);
  const ev = w.summary(Date.now()).events;
  assert.equal(ev.find((e) => e.type === "signature").what, "Sign-In with Ethereum message");
});

test("it never signs or sends a raw transaction, and refuses other addresses", async () => {
  const w = createTestWallet();
  for (const method of ["eth_sign", "eth_signTransaction", "eth_sendRawTransaction"]) assert.equal((await w.handle({ method, params: [] })).error.code, 4200, method);
  const other = "0x000000000000000000000000000000000000dEaD";
  assert.equal((await w.handle({ method: "personal_sign", params: ["0x68", other] })).error.code, 4100);
});

test("switching to an unknown chain is refused like MetaMask does (4902)", async () => {
  const w = createTestWallet();
  assert.equal((await w.handle({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] })).chainId, "0x14a34");
  assert.equal((await w.handle({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x999999" }] })).error.code, 4902);
});

test("revert data reads as words", () => {
  const data = "0x08c379a0" + "0000000000000000000000000000000000000000000000000000000000000020" + "0000000000000000000000000000000000000000000000000000000000000004" + Buffer.from("nope").toString("hex").padEnd(64, "0");
  assert.equal(revertReason(data), "nope");
  assert.equal(revertReason("0x4e487b710000000000000000000000000000000000000000000000000000000000000011"), "panic 0x11");
  assert.equal(revertReason(null), null);
});

test("a dapp is recognised by its connect-wallet button", () => {
  const page = (buttons) => ({ pages: [{ path: "/", title: "", headings: [], buttons, links: [], inputs: [], text: "" }] });
  assert.equal(looksLikeDapp(page(["Connect Wallet"])), true);
  assert.equal(looksLikeDapp(page(["Connect"])), true);
  assert.equal(looksLikeDapp(page(["Download APK", "Contact us"])), false);
  assert.deepEqual(CONNECT_STEP.do.map((a) => Object.keys(a)[0]), ["goto", "connectWallet", "expectWallet"]);
});

const A = (type, value = "", selector = "", n = 0) => ({ type, value, selector, n });
const S = (title, actions) => ({ title, demoAt: "", requires: "", why: "", actions });
const opts = { phase: "wallet", origin: "https://dapp.example", corpus: "mint", hrefs: [] };

test("wallet steps may press money buttons and expect what the wallet is asked for", () => {
  const [s] = toRunnerSteps([S("Mint", [A("goto", "/mint"), A("fill", "1", "input[name=amount]"), A("click", "Mint now"), A("expectWallet", "transaction")])], opts);
  assert.equal(s.id, "w2", "w1 is the built-in connect step");
  assert.deepEqual(s.do, [{ goto: "/mint" }, { fill: { selector: "input[name=amount]", value: "1" } }, { click: "Mint now" }, { expectWallet: "transaction" }]);
  assert.equal(s.unseenTarget, undefined, "screens behind a wallet were never explored: unseen text isn't 'missing'");
});

test("wallet steps still refuse off-chain effects", () => {
  const [s] = toRunnerSteps([S("Sign up", [A("click", "Sign up"), A("expectText", "Welcome")])], opts);
  assert.ok(s.requires && !s.do);
  const [t] = toRunnerSteps([S("Odd ask", [A("click", "Mint"), A("expectWallet", "everything")])], opts);
  assert.equal(t, undefined, "an unknown wallet expectation leaves no expect: the step is dropped");
});

test("demo and features never get wallet-only actions", () => {
  const [s] = toRunnerSteps([S("Hero", [A("goto", "/"), A("fill", "x", "input"), A("expectWallet", "transaction"), A("expectText", "mint")])], { ...opts, phase: "features" });
  assert.deepEqual(s.do, [{ goto: "/" }, { expectText: "mint" }]);
});
