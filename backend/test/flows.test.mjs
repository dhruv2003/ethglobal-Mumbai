import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress } from "../src/reviewer/net.mjs";
import { classifyDemo } from "../src/reviewer/demo.mjs";
import { corpusOf, toRunnerSteps } from "../src/reviewer/flows.mjs";

const discovery = { pages: [{ path: "/", title: "Tap", headings: ["Payments at the pace of a tap"], buttons: ["Download APK"], links: [{ text: "Docs", href: "https://tap.example/docs" }], inputs: [], text: "Turn any Android phone into a terminal" }] };
const corpus = corpusOf(discovery);
const A = (type, value = "", selector = "", n = 0) => ({ type, value, selector, n });
const S = (title, actions, extra = {}) => ({ title, demoAt: "", requires: "", why: "", actions, ...extra });

test("features may only use text the explorer saw", () => {
  const steps = toRunnerSteps([S("Hero", [A("goto", "/"), A("expectText", "Payments at the pace of a tap")]), S("Invented", [A("goto", "/"), A("expectText", "Merchant dashboard")])], { phase: "features", origin: "https://tap.example", corpus });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].title, "Hero");
});

test("demo steps keep unseen text but are flagged, so a miss reads as 'missing'", () => {
  const [s] = toRunnerSteps([S("Merchant screen", [A("expectText", "Enter amount")], { demoAt: "0:30" })], { phase: "demo", origin: "https://tap.example", corpus });
  assert.equal(s.unseenTarget, true);
  assert.equal(s.demoAt, "0:30");
  assert.deepEqual(s.do[0], { goto: "/" });
});

test("money and sign-in clicks become 'requires', never actions", () => {
  const [s] = toRunnerSteps([S("Pay", [A("click", "Pay with USDC"), A("expectText", "Paid")])], { phase: "demo", origin: "https://tap.example", corpus });
  assert.ok(s.requires && !s.do);
});

test("navigation off the site is dropped", () => {
  assert.equal(toRunnerSteps([S("Elsewhere", [A("goto", "https://evil.example/"), A("expectText", "x")])], { phase: "demo", origin: "https://tap.example", corpus }).length, 0);
});

test("steps without an expectation are dropped", () => {
  assert.equal(toRunnerSteps([S("Just clicks", [A("click", "Docs")])], { phase: "features", origin: "https://tap.example", corpus }).length, 0);
});

test("private and loopback addresses are refused for downloads", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.16.5.4", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("demo links are classified: Mux and files download, YouTube is skipped", () => {
  assert.equal(classifyDemo("https://stream.mux.com/abc123.m3u8").url, "https://stream.mux.com/abc123/high.mp4");
  assert.equal(classifyDemo("https://youtu.be/x").kind, "unsupported");
  assert.equal(classifyDemo("https://www.loom.com/share/17b1dc5da755422ea3177d4842556813").kind, "loom");
  assert.equal(classifyDemo("https://cdn.example/demo.mp4").kind, "file");
});
