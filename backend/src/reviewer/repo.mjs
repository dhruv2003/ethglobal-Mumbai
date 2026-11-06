/*
 * Read a submitted repository without ever running it.
 *
 * Clone: public github.com https URLs only; shallow; no hooks, no submodules,
 * no LFS; blobs over 1 MB skipped; time and size limits. Git never executes
 * code from a repo on clone with hooks disabled, and nothing here runs the
 * project's code (that needs the sandbox from PRD TST-05, not built yet).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/?$/;
const MAX_REPO_BYTES = 300 * 1024 * 1024;

const git = (args, opts = {}) =>
  run("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", ...args], {
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
    ...opts,
  });

function dirBytes(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    n += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return n;
}

/** Clone (or refresh) into dest. Returns { sha, committedAt }. */
export async function cloneRepo(url, dest) {
  const m = GITHUB_REPO.exec(String(url).trim());
  if (!m) throw new Error("Only public https://github.com/<owner>/<repo> links can be fetched.");
  const clean = `https://github.com/${m[1]}/${m[2].replace(/\.git$/, "")}`;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await git(["clone", "--depth", "200", "--no-recurse-submodules", "--filter=blob:limit=1m", "--single-branch", clean, dest]);
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/not found|Repository not found|could not read Username/i.test(msg)) throw new Error("The repository isn't public or doesn't exist.");
    if (e.killed) throw new Error("Fetching the repository took too long.");
    throw new Error(`git clone failed: ${msg.split("\n").filter(Boolean).pop()?.slice(0, 160)}`);
  }
  if (dirBytes(dest) > MAX_REPO_BYTES) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error("The repository is over 300 MB; too big to review.");
  }
  const { stdout } = await git(["-C", dest, "log", "-1", "--format=%H %cI"]);
  const [sha, committedAt] = stdout.trim().split(" ");
  return { sha, committedAt, url: clean };
}

/** Commit history facts from the (shallow) clone, split at the event start. */
export async function historyFacts(dir, eventStart) {
  const { stdout } = await git(["-C", dir, "log", "--format=%H %cI %an"]);
  const rows = stdout.trim().split("\n").filter(Boolean).map((l) => {
    const [sha, date, ...author] = l.split(" ");
    return { sha, date, author: author.join(" ") };
  });
  const start = Date.parse(eventStart);
  const during = rows.filter((r) => Date.parse(r.date) >= start).length;
  const shallow = fs.existsSync(path.join(dir, ".git", "shallow"));
  return {
    commitsSeen: rows.length,
    historyTruncated: shallow && rows.length >= 200,
    commitsDuringEvent: during,
    commitsBefore: rows.length - during,
    eventStart,
    firstCommitDate: rows.at(-1)?.date ?? null,
    lastCommitDate: rows[0]?.date ?? null,
    authors: [...new Set(rows.map((r) => r.author))].length,
  };
}

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|out|\.next|coverage|vendor|target|lib\/forge-std|lib\/openzeppelin[^/]*|\.turbo|\.cache|artifacts|cache|typechain[^/]*)(\/|$)/;
const SKIP_FILE = /(\.lock$|-lock\.json$|\.min\.(js|css)$|\.map$|\.(png|jpe?g|gif|webp|ico|svg|mp4|mov|pdf|zip|gz|woff2?|ttf|eot|wasm|bin|dat)$)/i;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|sol|py|rs|go|move|cairo|vy|java|kt|swift)$/i;

/** Tracked text files worth reading, with sizes. */
export async function inventory(dir) {
  const { stdout } = await git(["-C", dir, "ls-files"]);
  const files = [];
  for (const f of stdout.split("\n").filter(Boolean)) {
    if (SKIP_DIR.test(f) || SKIP_FILE.test(f)) continue;
    const full = path.join(dir, f);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue; // blob skipped by the size filter
    }
    if (!st.isFile() || st.size > 400 * 1024) continue;
    files.push({ path: f, bytes: st.size });
  }
  return files;
}

/** Count tests by reading files, never running them. */
export function countTests(dir, files) {
  let jsFiles = 0;
  let jsCases = 0;
  let solFiles = 0;
  let solTests = 0;
  let pyFiles = 0;
  let pyTests = 0;
  for (const f of files) {
    const text = () => fs.readFileSync(path.join(dir, f.path), "utf8");
    if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.path)) {
      jsFiles++;
      jsCases += (text().match(/\b(it|test)(\.each\([^)]*\))?\s*\(/g) ?? []).length;
    } else if (/\.t\.sol$/.test(f.path)) {
      solFiles++;
      solTests += (text().match(/function\s+(test|testFuzz|invariant)\w*\s*\(/g) ?? []).length;
    } else if (/(^|\/)test_[^/]+\.py$|_test\.py$/.test(f.path)) {
      pyFiles++;
      pyTests += (text().match(/^\s*def\s+test_\w+/gm) ?? []).length;
    }
  }
  return { jsFiles, jsCases, solFiles, solTests, pyFiles, pyTests };
}

/** Rank files so the reviewer reads what matters first. */
function rank(f) {
  const p = f.path.toLowerCase();
  if (/^readme(\.\w+)?$/.test(p)) return 0;
  if (/(^|\/)(package\.json|foundry\.toml|hardhat\.config\.\w+|cargo\.toml|pyproject\.toml|requirements\.txt)$/.test(p)) return 1;
  if (/\.sol$/.test(p) && !/\.t\.sol$/.test(p) && !/(^|\/)(test|script|mock)/.test(p)) return 2;
  if (/(^|\/)(readme|docs?\/|spec|architecture|deployments?)[^/]*\.md$/.test(p)) return 3;
  if (CODE.test(p) && /(^|\/)(src|app|contracts|server|api|lib|pages|components|services|backend|frontend)\//.test(p) && !/\.(test|spec)\./.test(p)) return 4;
  if (/\.(test|spec)\.|\.t\.sol$/.test(p)) return 6;
  if (CODE.test(p)) return 5;
  if (/\.(md|json|toml|ya?ml)$/.test(p)) return 7;
  return 9;
}

/**
 * A bounded, line-numbered pack of the repo for the reviewer.
 * Every included file carries line numbers so references can be checked later.
 */
export function contextPack(dir, files, { maxChars = 180000, maxLinesPerFile = 350 } = {}) {
  const tree = files.map((f) => f.path).slice(0, 600).join("\n");
  const parts = [`## File tree (${files.length} readable files${files.length > 600 ? ", first 600 shown" : ""})\n${tree}`];
  let used = parts[0].length;
  const included = [];
  const truncated = [];
  for (const f of [...files].sort((a, b) => rank(a) - rank(b) || a.bytes - b.bytes)) {
    if (rank(f) >= 9) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f.path), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    const lines = text.split("\n");
    const shown = lines.slice(0, maxLinesPerFile);
    const block = `\n\n## ${f.path}${lines.length > shown.length ? ` (first ${shown.length} of ${lines.length} lines)` : ""}\n${shown.map((l, i) => `${String(i + 1).padStart(4)}| ${l.slice(0, 240)}`).join("\n")}`;
    if (used + block.length > maxChars) {
      truncated.push(f.path);
      continue;
    }
    parts.push(block);
    used += block.length;
    included.push(f.path);
  }
  return { text: parts.join(""), included, notIncluded: truncated.length, chars: used };
}

/** Is "path:line" a real line in the clone? */
export function refExists(dir, ref) {
  const m = /^(.+?):(\d+)(?:-\d+)?$/.exec(String(ref).trim());
  if (!m) return false;
  const rel = path.normalize(m[1]).replace(/^(\.\/)+/, "");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const full = path.join(dir, rel);
  try {
    if (!fs.lstatSync(full).isFile()) return false;
    const n = fs.readFileSync(full, "utf8").split("\n").length;
    const line = Number(m[2]);
    return line >= 1 && line <= n;
  } catch {
    return false;
  }
}
