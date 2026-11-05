import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, safeFetch } from "../src/reviewer/net.mjs";
import { classifyDemo, sniffContainer } from "../src/reviewer/demo.mjs";
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
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.16.5.4", "169.254.169.254", "0.0.0.0", "100.64.1.1", "::1", "::", "fd00::1", "fe80::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:1", "::7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "not-an-ip"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["8.8.8.8", "151.101.1.1", "20.207.73.85", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("demo links are classified: Mux and files download, YouTube is skipped", () => {
  assert.equal(classifyDemo("https://stream.mux.com/abc123.m3u8").url, "https://stream.mux.com/abc123/high.mp4");
  assert.equal(classifyDemo("https://youtu.be/x").kind, "unsupported");
  assert.equal(classifyDemo("https://www.loom.com/share/17b1dc5da755422ea3177d4842556813").kind, "loom");
  assert.equal(classifyDemo("https://cdn.example/demo.mp4").kind, "file");
});

test("downloads refuse private hosts, including mapped IPv6 spellings and names that resolve locally", async () => {
  for (const url of ["https://127.0.0.1/x", "https://[::ffff:7f00:1]/x", "https://[::ffff:a9fe:a9fe]/x", "https://localhost/x", "http://example.com/x"]) {
    await assert.rejects(safeFetch(url, { timeoutMs: 5000 }), /private|https/, url);
  }
});

test("only real video containers reach ffmpeg (no playlists or concat lists)", () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(8)]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  assert.equal(sniffContainer(mp4), "mov");
  assert.equal(sniffContainer(webm), "matroska");
  for (const bad of ["#EXTM3U\n#EXT-X-VERSION:3\nhttp://169.254.169.254/x.ts\n", "ffconcat version 1.0\nfile '/etc/passwd'\n", "<html>not a video</html>"]) {
    assert.equal(sniffContainer(Buffer.from(bad)), null, bad.slice(0, 20));
  }
});
