import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { durationMs, findContractProjects, lockedFoundryToml, parseForgeJson, parseGitmodules, removeSymlinks, safeRemapping, startEgressProxy, totalsOf } from "../src/reviewer/contracts.mjs";

const root = path.resolve("/work/project");

test("finds Foundry and Hardhat projects, ignoring dependencies", () => {
  const f = findContractProjects(["foundry.toml", "lib/forge-std/foundry.toml", "contracts/hardhat.config.ts", "contracts/test/Pool.test.ts", "node_modules/x/hardhat.config.js", "web/package.json"]);
  assert.deepEqual(f.foundry, ["."]);
  assert.deepEqual(f.hardhat, [{ root: "contracts", testFiles: 1 }]);
});

test("a folder with both configs is run as Foundry, not listed as Hardhat", () => {
  const f = findContractProjects(["chain/foundry.toml", "chain/hardhat.config.js"]);
  assert.deepEqual(f.foundry, ["chain"]);
  assert.deepEqual(f.hardhat, []);
});

test("remappings may only point inside the project", () => {
  assert.equal(safeRemapping("forge-std/=lib/forge-std/src/", root), "forge-std/=lib/forge-std/src/");
  assert.equal(safeRemapping(`@oz/=${path.join(root, "node_modules/@openzeppelin/")}`, root), "@oz/=node_modules/@openzeppelin/");
  assert.equal(safeRemapping("evil/=/proc/1/", root), null);
  assert.equal(safeRemapping("evil/=../../etc/", root), null);
  assert.equal(safeRemapping("not a remapping", root), null);
});

test("our foundry.toml turns off every way out of the EVM, whatever the team's said", () => {
  const toml = lockedFoundryToml(
    {
      src: "src",
      test: "../../outside",
      libs: ["lib", "/etc"],
      remappings: ["ok/=src/", "evil/=/proc/self/"],
      solc: "./evil.sh",
      ffi: true,
      fs_permissions: [{ access: "read-write", path: "/" }],
      allow_paths: ["/"],
      evm_version: "cancun",
      via_ir: true,
      optimizer_runs: 1e12,
      fuzz: { runs: 100000 },
      invariant: { runs: 9999, depth: 9999 },
    },
    root,
  );
  assert.match(toml, /^ffi = false$/m);
  assert.match(toml, /^fs_permissions = \[\]$/m);
  assert.match(toml, /^allow_paths = \[\]$/m);
  assert.match(toml, /^auto_detect_remappings = false$/m);
  assert.match(toml, /^auto_detect_solc = true$/m, "a solc path is never kept, only version numbers");
  assert.doesNotMatch(toml, /evil|\/proc|\/etc|outside/);
  assert.match(toml, /^remappings = \["ok\/=src\/"\]$/m);
  assert.match(toml, /^libs = \["lib"\]$/m);
  assert.match(toml, /^evm_version = "cancun"$/m);
  assert.match(toml, /\[profile\.default\.fuzz\]\nruns = 1000/);
  assert.match(toml, /\[profile\.default\.invariant\]\nruns = 256\ndepth = 100/);
  assert.match(lockedFoundryToml({ solc: "0.8.24" }, root), /^solc = "0\.8\.24"$/m);
});

test("reads .gitmodules", () => {
  const list = parseGitmodules('[submodule "lib/forge-std"]\n\tpath = lib/forge-std\n\turl = https://github.com/foundry-rs/forge-std\n[submodule "x"]\n\tpath = lib/x\n');
  assert.deepEqual(list, [{ path: "lib/forge-std", url: "https://github.com/foundry-rs/forge-std" }]);
});

test("reads forge test --json", () => {
  const out = `Compiling...\n${JSON.stringify({
    "test/Counter.t.sol:CounterTest": {
      duration: "3ms 200µs",
      test_results: {
        "test_Increment()": { status: "Success", reason: null, kind: { Unit: { gas: 31303 } }, duration: "1ms 500µs", decoded_logs: [] },
        "testFuzz_SetNumber(uint256)": { status: "Success", kind: { Fuzz: { runs: 256, mean_gas: 30000, median_gas: 29000 } }, duration: { secs: 0, nanos: 9000000 } },
        "test_Broken()": { status: "Failure", reason: "assertion failed: 1 != 2", kind: { Unit: { gas: 100 } }, duration: "10µs", counterexample: null },
      },
    },
  })}`;
  const suites = parseForgeJson(out);
  assert.equal(suites[0].contract, "CounterTest");
  assert.equal(suites[0].file, "test/Counter.t.sol");
  const [a, b, c] = suites[0].tests;
  assert.deepEqual([a.status, a.kind, a.gas, a.ms], ["passed", "unit", 31303, 1.5]);
  assert.deepEqual([b.kind, b.runs, b.ms], ["fuzz", 256, 9]);
  assert.deepEqual([c.status, c.reason], ["failed", "assertion failed: 1 != 2"]);
  assert.deepEqual(totalsOf(suites), { passed: 2, failed: 1, skipped: 0, fuzz: 1, invariant: 0 });
  assert.equal(durationMs("1s 5ms"), 1005);
});

test("the egress proxy refuses private addresses, other ports and plain HTTP", async () => {
  const proxy = await startEgressProxy();
  const port = Number(new URL(proxy.url).port);
  const connect = (target) =>
    new Promise((resolve) => {
      const s = new net.Socket();
      s.connect(port, "127.0.0.1", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
      s.once("data", (d) => {
        resolve(String(d).split("\r\n")[0]);
        s.destroy();
      });
      s.on("error", () => resolve("error"));
    });
  try {
    assert.match(await connect("127.0.0.1:443"), /403/);
    assert.match(await connect("localhost:443"), /403/);
    assert.match(await connect("169.254.169.254:443"), /403/);
    assert.match(await connect("example.com:22"), /403/);
    const res = await fetch(`${proxy.url}/http://example.com/`).catch(() => null);
    assert.equal(res?.status, 403);
  } finally {
    await proxy.close();
  }
});


test("a remapping through a symlink that leaves the project is refused, and installs' symlinks are removed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-"));
  const proj = path.join(tmp, "proj");
  const outside = path.join(tmp, "secret");
  fs.mkdirSync(path.join(proj, "node_modules"), { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(proj, "node_modules", "evil"), "dir");
  fs.mkdirSync(path.join(proj, "lib", "ok"), { recursive: true });
  try {
    assert.equal(safeRemapping("evil/=node_modules/evil/", proj), null);
    assert.equal(safeRemapping("ok/=lib/ok/", proj), "ok/=lib/ok/");
    assert.equal(removeSymlinks(proj), 1);
    assert.equal(fs.existsSync(path.join(proj, "node_modules", "evil")), false);
    assert.equal(fs.existsSync(outside), true); // only the link goes, never its target
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
