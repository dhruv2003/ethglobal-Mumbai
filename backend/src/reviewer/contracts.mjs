/*
 * Run a submission's smart contract tests, sandboxed.
 *
 * Foundry projects (a foundry.toml) are compiled and tested with `forge`. Solidity tests run
 * inside forge's EVM; the ways out of it are cheatcodes and config, and each is closed:
 *
 *   - the team's foundry.toml is REPLACED by one we write from an allow-list of its settings
 *     (forge resolves it with `forge config --json`): ffi = false, fs_permissions = [],
 *     no allow_paths/include_paths, no custom solc binary (version numbers only), remappings
 *     only to folders inside the project, fuzz/invariant runs capped
 *   - our working copy has no symlinks, no .git, no node_modules and no .env files (forge
 *     loads .env files into its own environment)
 *   - the environment is rebuilt from nothing: PATH, a scratch HOME, public RPC URLs. No server
 *     secret is ever passed
 *   - every network request goes through a local proxy that only allows HTTPS (port 443) to
 *     public addresses: fork tests and compiler downloads work, the server's private network
 *     doesn't answer
 *   - on Linux as root (the container), forge, git and npm run as `nobody` (setpriv), so even a
 *     path trick can't read another process's memory or environment
 *   - time limits on every command
 *
 * Dependencies: git submodules (github.com https only, pinned to the commit the repo records),
 * Soldeer packages (`forge soldeer install`), and npm packages when remappings point into
 * node_modules (`npm install --ignore-scripts`: nothing from the packages runs).
 *
 * Hardhat projects are found and their tests counted, not run: Hardhat tests are JavaScript
 * with full Node access, which needs a container sandbox (not built yet).
 */
import { execFile, execFileSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { CHAINS } from "../../tester/chains.mjs";
import { scratch } from "../datafiles.mjs";
import { isPrivateAddress } from "./net.mjs";

const FORGE = process.env.FORGE_BIN ?? "forge";
const MAX_PROJECTS = 2;
const MAX_SUBMODULES = 16;
const MAX_TESTS_KEPT = 500;
const MIN = 60 * 1000;
const LIMITS = { deps: 4 * MIN, config: 1 * MIN, build: 8 * MIN, test: 8 * MIN };

/** Solc downloads and compiled-library caches, shared between runs (scratch, never data). */
const forgeHome = () => process.env.FORGE_HOME_DIR ?? scratch("forge-home");

// ---------- running a command, sandboxed ----------

const AS_NOBODY = process.platform === "linux" && process.getuid?.() === 0 && hasCommand("setpriv");
const NOBODY = 65534;

function hasCommand(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/** Give a folder tree to `nobody` (only when we drop to it). */
function giveToNobody(dir) {
  if (!AS_NOBODY) return;
  fs.chownSync(dir, NOBODY, NOBODY);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) giveToNobody(p);
    else fs.chownSync(p, NOBODY, NOBODY);
  }
}

/** Public RPC URLs under the names fork tests usually read (vm.envString / rpc_endpoints). Not ETH_RPC_URL: forge would fork every test. */
function rpcEnv() {
  const env = {};
  for (const c of Object.values(CHAINS)) env[`${c.alias.toUpperCase()}_RPC_URL`] = c.rpc;
  env.ETHEREUM_RPC_URL = CHAINS[1].rpc;
  return env;
}

/** The whole environment a sandboxed command gets. Nothing from the server's own environment but PATH. */
function cleanEnv(proxy) {
  const home = forgeHome();
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    npm_config_cache: path.join(home, ".npm"),
    npm_config_update_notifier: "false",
    NO_COLOR: "1",
    CI: "1",
    FOUNDRY_DISABLE_NIGHTLY_WARNING: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    ...rpcEnv(),
  };
  if (proxy) {
    for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) env[k] = proxy;
    env.NO_PROXY = env.no_proxy = "";
  }
  // Windows (development only) needs a few system variables to start processes at all.
  // Its compiler manager also needs the real user profile there (it asks Windows for the user's data folder).
  if (process.platform === "win32") for (const k of ["SystemRoot", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "USERNAME", "HOMEDRIVE", "HOMEPATH"]) if (process.env[k]) env[k] = process.env[k];
  return env;
}

/** Run one command in the sandbox. Resolves { code, stdout, stderr, ms, timedOut } (never rejects on a non-zero exit). */
function sandboxed(cmd, args, { cwd, timeout, proxy }) {
  const [file, argv] = AS_NOBODY ? ["setpriv", [`--reuid=${NOBODY}`, `--regid=${NOBODY}`, "--clear-groups", "--no-new-privs", cmd, ...args]] : [cmd, args];
  const t = Date.now();
  return new Promise((resolve) => {
    execFile(file, argv, { cwd, timeout, env: cleanEnv(proxy), maxBuffer: 96 * 1024 * 1024, killSignal: "SIGKILL", windowsHide: true, shell: process.platform === "win32" && cmd === "npm" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), ms: Date.now() - t, timedOut: Boolean(err?.killed), error: err && typeof err.code !== "number" ? String(err.message) : null });
    });
  });
}

const tail = (s, n = 1500) => {
  const t = String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
};

// ---------- egress: HTTPS to public addresses only ----------

/**
 * A local CONNECT proxy for the sandboxed commands: port 443 to public addresses only, checked
 * at connect time (no DNS-rebinding window). Plain-HTTP requests are refused.
 */
export async function startEgressProxy() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("FightClub sandbox: only HTTPS to public hosts.");
  });
  server.on("connect", (req, client, head) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(String(req.url ?? ""));
    const refuse = () => client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    if (!m || Number(m[2]) !== 443) return refuse();
    dns.lookup(m[1], { all: true, verbatim: true }, (err, addrs) => {
      if (err || !addrs?.length || addrs.some((a) => isPrivateAddress(a.address))) return refuse();
      const up = net.connect({ host: addrs[0].address, port: 443 }, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) up.write(head);
        up.pipe(client);
        client.pipe(up);
      });
      sockets.add(up);
      up.on("close", () => sockets.delete(up));
      up.setTimeout(120000, () => up.destroy());
      up.on("error", () => client.destroy());
      client.on("close", () => up.destroy());
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((r) => server.close(() => r()));
    },
  };
}

// ---------- finding projects ----------

const SKIP_DIRS = /(^|\/)(node_modules|lib|dependencies|out|cache|artifacts|broadcast|\.git)\//;

/** Foundry and Hardhat projects in a cloned repo, from its file list. */
export function findContractProjects(files) {
  const paths = files.map((f) => f.path ?? f);
  const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
  const foundry = paths.filter((p) => /(^|\/)foundry\.toml$/.test(p) && !SKIP_DIRS.test(p)).map(dirOf).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const hardhat = paths
    .filter((p) => /(^|\/)hardhat\.config\.(js|ts|cjs|mjs)$/.test(p) && !SKIP_DIRS.test(p))
    .map(dirOf)
    .filter((d) => !foundry.includes(d))
    .map((root) => {
      const inRoot = (p) => (root === "." ? true : p.startsWith(`${root}/`));
      const tests = paths.filter((p) => inRoot(p) && /(^|\/)test\/.+\.(js|ts|cjs|mjs)$/.test(p) && !SKIP_DIRS.test(p.slice(root === "." ? 0 : root.length + 1)));
      return { root, testFiles: tests.length };
    });
  return { foundry: foundry.slice(0, MAX_PROJECTS), foundryFound: foundry.length, hardhat };
}

// ---------- preparing a project ----------

const isInside = (root, p) => {
  const r = path.relative(root, p);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};

/** Copy the clone for running: no .git, node_modules, symlinks or .env files. */
function workingCopy(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const b = path.basename(p);
      if (b === ".git" || b === "node_modules" || /^\.env/i.test(b)) return false;
      try {
        return !fs.lstatSync(p).isSymbolicLink();
      } catch {
        return false;
      }
    },
  });
}

const GITHUB_HTTPS = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?(\.git)?\/?$/;

/** [{ path, url }] from a .gitmodules file. */
export function parseGitmodules(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*\[submodule\s+"/.test(line)) {
      cur = {};
      out.push(cur);
      continue;
    }
    const m = /^\s*(path|url)\s*=\s*(.+?)\s*$/.exec(line);
    if (m && cur) cur[m[1]] = m[2];
  }
  return out.filter((s) => s.path && s.url);
}

/** The commit our own clone records for a submodule path (git ls-tree reads the object store; nothing from the repo runs), or null. */
function gitlinkSha(repo, subPath) {
  return new Promise((resolve) => {
    execFile("git", ["-c", "core.hooksPath=/dev/null", "-C", repo, "ls-tree", "HEAD", "--", subPath], { timeout: 30000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : (/^160000 commit ([0-9a-f]{40})\t/m.exec(String(stdout))?.[1] ?? null));
    });
  });
}

/** Fetch git submodules (github.com only, pinned commits, shallow), two levels deep. */
async function fetchSubmodules(gitRepo, work, proxy, say, budget = { left: MAX_SUBMODULES }, depth = 0) {
  const list = fs.existsSync(path.join(work, ".gitmodules")) ? parseGitmodules(fs.readFileSync(path.join(work, ".gitmodules"), "utf8")) : [];
  const done = [];
  for (const sm of list) {
    if (budget.left <= 0) {
      done.push({ kind: "git", name: sm.path, ok: false, detail: "skipped: too many submodules" });
      continue;
    }
    const dest = path.resolve(work, sm.path);
    const url = sm.url.trim();
    if (!isInside(work, dest) || sm.path.includes("..")) {
      done.push({ kind: "git", name: sm.path, ok: false, detail: "path outside the project" });
      continue;
    }
    if (!GITHUB_HTTPS.test(url)) {
      done.push({ kind: "git", name: sm.path, ok: false, detail: "only https://github.com submodules are fetched" });
      continue;
    }
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
      done.push({ kind: "git", name: sm.path, ok: true, detail: "already in the repo" });
      continue;
    }
    budget.left--;
    // Top level: the commit recorded in the clone. Nested: the recorded commit isn't known without a full fetch, so the default branch.
    const sha = gitRepo ? await gitlinkSha(gitRepo, sm.path) : null;
    say(`Fetching ${sm.path}${sha ? ` @ ${sha.slice(0, 7)}` : ""}`);
    fs.mkdirSync(dest, { recursive: true });
    giveToNobody(dest);
    const g = (args, timeout = 120000) => sandboxed("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "advice.detachedHead=false", ...args], { cwd: dest, timeout, proxy });
    let r = await g(["init", "-q"]);
    if (!r.code) r = await g(["fetch", "-q", "--depth", "1", url.replace(/\/$/, ""), sha ?? "HEAD"]);
    if (!r.code) r = await g(["checkout", "-q", "FETCH_HEAD"]);
    if (r.code) {
      done.push({ kind: "git", name: sm.path, ok: false, detail: tail(r.stderr || r.error, 200) || "git failed" });
      continue;
    }
    fs.rmSync(path.join(dest, ".git"), { recursive: true, force: true });
    for (const f of fs.readdirSync(dest)) if (/^\.env/i.test(f)) fs.rmSync(path.join(dest, f), { force: true });
    done.push({ kind: "git", name: sm.path, ok: true, detail: sha ? `pinned ${sha.slice(0, 7)}` : "default branch" });
    if (depth < 1) done.push(...(await fetchSubmodules(null, dest, proxy, say, budget, depth + 1)).map((d) => ({ ...d, name: `${sm.path}/${d.name}` })));
  }
  return done;
}

/** A "context:prefix=target" remapping, kept only if its target is inside the project; written relative. */
export function safeRemapping(line, root) {
  const m = /^([^=]+)=(.+)$/.exec(String(line).trim());
  if (!m) return null;
  const target = path.resolve(root, m[2]);
  if (!isInside(root, target) || /[\0\n"]/.test(line)) return null;
  let rel = path.relative(root, target).split(path.sep).join("/");
  if (/[\\/]$/.test(m[2]) && !rel.endsWith("/")) rel += "/";
  return `${m[1]}=${rel || "./"}`;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const relOk = (root, p) => typeof p === "string" && p.length > 0 && p.length < 200 && !/[\0\n"]/.test(p) && isInside(root, path.resolve(root, p));
const relOf = (root, p) => path.relative(root, path.resolve(root, p)).split(path.sep).join("/") || ".";
const intIn = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.trunc(Number(v)))) : dflt);

/** Our foundry.toml, from forge's resolved view of the team's (an allow-list; everything risky off). */
export function lockedFoundryToml(cfg, root) {
  const L = ["# Written by FightClub's contract test runner; the team's foundry.toml was replaced.", "# No FFI, no file access, no custom solc binary, remappings only inside the project.", "[profile.default]"];
  const put = (k, v) => L.push(`${k} = ${JSON.stringify(v)}`);
  for (const k of ["src", "test", "script", "out"]) if (relOk(root, cfg[k])) put(k, relOf(root, cfg[k]));
  const libs = (cfg.libs ?? []).filter((p) => relOk(root, p)).map((p) => relOf(root, p));
  put("libs", libs.length ? libs : ["lib"]);
  put("remappings", (cfg.remappings ?? []).map((r) => safeRemapping(r, root)).filter(Boolean));
  put("auto_detect_remappings", false);
  const solc = typeof cfg.solc === "string" ? cfg.solc : typeof cfg.solc_version === "string" ? cfg.solc_version : null;
  if (solc && VERSION.test(solc)) put("solc", solc);
  else put("auto_detect_solc", true);
  if (typeof cfg.evm_version === "string" && /^[a-z]+$/i.test(cfg.evm_version)) put("evm_version", cfg.evm_version.toLowerCase());
  if (typeof cfg.optimizer === "boolean") put("optimizer", cfg.optimizer);
  if (cfg.optimizer_runs != null) put("optimizer_runs", intIn(cfg.optimizer_runs, 0, 4294967295, 200));
  if (typeof cfg.via_ir === "boolean") put("via_ir", cfg.via_ir);
  put("ffi", false);
  L.push("fs_permissions = []", "allow_paths = []", "include_paths = []");
  put("offline", false);
  L.push("", "[profile.default.fuzz]");
  put("runs", intIn(cfg.fuzz?.runs, 1, 1000, 256));
  L.push("", "[profile.default.invariant]");
  put("runs", intIn(cfg.invariant?.runs, 1, 256, 64));
  put("depth", intIn(cfg.invariant?.depth, 1, 100, 50));
  if (typeof cfg.invariant?.fail_on_revert === "boolean") put("fail_on_revert", cfg.invariant.fail_on_revert);
  L.push("", "[rpc_endpoints]");
  for (const c of Object.values(CHAINS)) put(c.alias, c.rpc);
  put("ethereum", CHAINS[1].rpc);
  return `${L.join("\n")}\n`;
}

/** Remove every remappings.txt and foundry.toml below the root (libs' too): only our config is read. */
function stripConfigs(root) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "remappings.txt" || (e.name === "foundry.toml" && dir !== root)) fs.rmSync(p, { force: true });
    }
  };
  walk(root);
}

// ---------- reading forge's results ----------

/** "26ms 397µs 700ns", "1s 5ms" or { secs, nanos } -> milliseconds. */
export function durationMs(d) {
  if (d && typeof d === "object") return Math.round((d.secs ?? 0) * 1000 + (d.nanos ?? 0) / 1e6);
  const unit = { h: 3600000, m: 60000, s: 1000, ms: 1, "µs": 1e-3, us: 1e-3, ns: 1e-6 };
  let ms = 0;
  for (const [, n, u] of String(d ?? "").matchAll(/([\d.]+)\s*(ms|µs|us|ns|h|m|s)\b/g)) ms += Number(n) * (unit[u] ?? 0);
  return Math.round(ms * 10) / 10;
}

/** `forge test --json` output -> suites of tests. */
export function parseForgeJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("forge printed no results");
  const data = JSON.parse(text.slice(start));
  let kept = 0;
  const suites = [];
  for (const [key, suite] of Object.entries(data)) {
    const i = key.lastIndexOf(":");
    const tests = [];
    for (const [name, r] of Object.entries(suite.test_results ?? {})) {
      if (kept++ >= MAX_TESTS_KEPT) break;
      const k = r.kind ?? {};
      const kind = k.Fuzz ? "fuzz" : k.Invariant ? "invariant" : "unit";
      const info = k.Unit ?? k.Fuzz ?? k.Invariant ?? {};
      tests.push({
        name,
        status: r.status === "Success" ? "passed" : r.status === "Skipped" ? "skipped" : "failed",
        kind,
        ...(info.gas != null ? { gas: info.gas } : {}),
        ...(info.mean_gas != null ? { gas: info.mean_gas } : {}),
        ...(info.runs != null ? { runs: info.runs } : {}),
        ...(info.calls != null ? { calls: info.calls } : {}),
        ms: durationMs(r.duration),
        ...(r.reason ? { reason: String(r.reason).slice(0, 400) } : {}),
        ...(r.counterexample ? { counterexample: JSON.stringify(r.counterexample).slice(0, 400) } : {}),
        ...(r.decoded_logs?.length ? { logs: r.decoded_logs.slice(0, 6).map((l) => String(l).slice(0, 200)) } : {}),
      });
    }
    suites.push({ file: i > 0 ? key.slice(0, i) : key, contract: i > 0 ? key.slice(i + 1) : key, ms: durationMs(suite.duration), tests });
  }
  return suites;
}

export const totalsOf = (suites) => {
  const t = { passed: 0, failed: 0, skipped: 0, fuzz: 0, invariant: 0 };
  for (const s of suites)
    for (const x of s.tests) {
      t[x.status]++;
      if (x.kind !== "unit") t[x.kind]++;
    }
  return t;
};

// ---------- the run ----------

export async function forgeVersion() {
  const r = await sandboxed(FORGE, ["--version"], { cwd: process.cwd(), timeout: 20000 });
  return r.code ? null : r.stdout.split("\n")[0].trim();
}

/**
 * Run the Foundry tests of every Foundry project in the clone (at most two).
 * onPart(partId, status, detail) reports progress: parts deps, build, test.
 * Returns the report stored for the project.
 */
export async function runContractTests({ projectId, repoDir, files, commit, onPart = () => {} }) {
  const found = findContractProjects(files);
  const report = {
    ranAt: new Date().toISOString(),
    commit: commit ?? null,
    tool: null,
    sandbox: {
      user: AS_NOBODY ? "nobody (setpriv)" : "the server's user",
      network: "HTTPS to public hosts only, through a filtering proxy",
      config: "the team's foundry.toml replaced: ffi off, no file access, no custom solc, remappings inside the project",
    },
    projects: [],
    hardhat: found.hardhat.map((h) => ({ ...h, note: "Not run: Hardhat tests are JavaScript with full Node access and need a container sandbox." })),
    foundryProjectsFound: found.foundryFound,
  };
  if (!found.foundry.length) return { ...report, status: found.hardhat.length ? "not_run" : "none" };

  const version = await forgeVersion();
  if (!version) return { ...report, status: "error", error: "Foundry (forge) isn't installed on the server." };
  report.tool = version;

  const workRoot = scratch("contracts", projectId);
  fs.mkdirSync(forgeHome(), { recursive: true });
  workingCopy(repoDir, workRoot);
  giveToNobody(workRoot);
  giveToNobody(forgeHome());
  const proxy = await startEgressProxy();
  try {
    // Submodules are recorded at the repo root; fetch them once for every project.
    onPart("deps", "running", "Reading .gitmodules");
    const deps = await fetchSubmodules(repoDir, workRoot, proxy.url, (m) => onPart("deps", "running", m));
    for (const root of found.foundry) {
      const dir = path.resolve(workRoot, root);
      const p = { root, dependencies: [...deps], build: null, suites: [], totals: null };
      report.projects.push(p);
      const at = root === "." ? "" : ` (${root})`;

      // Soldeer packages
      const toml = fs.readFileSync(path.join(dir, "foundry.toml"), "utf8");
      if (/^\s*\[dependencies\]/m.test(toml) || fs.existsSync(path.join(dir, "soldeer.lock"))) {
        onPart("deps", "running", `Soldeer packages${at}`);
        const r = await sandboxed(FORGE, ["soldeer", "install"], { cwd: dir, timeout: LIMITS.deps, proxy: proxy.url });
        p.dependencies.push({ kind: "soldeer", name: "soldeer packages", ok: !r.code, detail: r.code ? tail(r.stderr || r.stdout, 200) : "installed" });
      }
      // npm packages, only when remappings point into node_modules
      const remapText = [toml, fs.existsSync(path.join(dir, "remappings.txt")) ? fs.readFileSync(path.join(dir, "remappings.txt"), "utf8") : ""].join("\n");
      if (/node_modules\//.test(remapText)) {
        let pkgDir = dir;
        while (!fs.existsSync(path.join(pkgDir, "package.json")) && isInside(workRoot, path.dirname(pkgDir)) && pkgDir !== workRoot) pkgDir = path.dirname(pkgDir);
        if (fs.existsSync(path.join(pkgDir, "package.json"))) {
          onPart("deps", "running", `npm packages${at} (install scripts off)`);
          const lock = fs.existsSync(path.join(pkgDir, "package-lock.json"));
          const r = await sandboxed("npm", [lock ? "ci" : "install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", "--registry=https://registry.npmjs.org/"], { cwd: pkgDir, timeout: LIMITS.deps, proxy: proxy.url });
          p.dependencies.push({ kind: "npm", name: path.relative(workRoot, pkgDir) || "package.json", ok: !r.code, detail: r.code ? tail(r.stderr, 200) : "installed, scripts off" });
        }
      }

      // Resolve the team's config, then replace it with ours.
      onPart("build", "running", `Resolving the Foundry config${at}`);
      const c = await sandboxed(FORGE, ["config", "--json"], { cwd: dir, timeout: LIMITS.config, proxy: proxy.url });
      let cfg;
      try {
        cfg = JSON.parse(c.stdout.slice(c.stdout.indexOf("{")));
      } catch {
        p.build = { ok: false, error: `forge couldn't read foundry.toml: ${tail(c.stderr || c.stdout, 400)}` };
        continue;
      }
      stripConfigs(dir);
      fs.writeFileSync(path.join(dir, "foundry.toml"), lockedFoundryToml(cfg, dir));
      giveToNobody(dir);

      // Compile
      onPart("build", "running", `forge build${at}`);
      const b = await sandboxed(FORGE, ["build"], { cwd: dir, timeout: LIMITS.build, proxy: proxy.url });
      p.build = { ok: !b.code, seconds: Math.round(b.ms / 100) / 10, ...(b.code ? { error: b.timedOut ? "Compiling took too long." : tail(b.stderr || b.stdout) } : {}) };
      if (b.code) continue;

      // Test
      onPart("test", "running", `forge test${at}`);
      const t = await sandboxed(FORGE, ["test", "--json"], { cwd: dir, timeout: LIMITS.test, proxy: proxy.url });
      p.testSeconds = Math.round(t.ms / 100) / 10;
      if (t.timedOut) {
        p.error = "The tests took longer than the time limit.";
        continue;
      }
      try {
        p.suites = parseForgeJson(t.stdout);
        p.totals = totalsOf(p.suites);
      } catch {
        p.error = `forge test failed: ${tail(t.stderr || t.stdout, 600)}`;
      }
    }
  } finally {
    await proxy.close();
    fs.rmSync(workRoot, { recursive: true, force: true });
  }

  const totals = totalsOf(report.projects.flatMap((p) => p.suites));
  report.totals = totals;
  const broken = report.projects.some((p) => !p.build?.ok || p.error);
  const ran = totals.passed + totals.failed;
  report.status = !ran ? (broken ? "error" : "no_tests") : totals.failed || broken ? "failed" : "passed";
  return report;
}
