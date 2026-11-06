import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GITHUB_REPO, cloneRepo, contextPack, countTests, refExists } from "../src/reviewer/repo.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-repo-"));
const put = (p, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), text);
};
put("README.md", "# Demo\nline two\n");
put("src/app.ts", "export const a = 1;\nexport const b = 2;\n");
put("src/app.test.ts", "it('a', () => {});\ntest('b', () => {});\ntest.each([1])('c', () => {});\n");
put("contracts/Pool.t.sol", "function testJoin() public {}\nfunction testFuzz_x(uint a) public {}\nfunction helper() internal {}\n");
put("tests/test_api.py", "def test_one():\n    pass\ndef helper():\n    pass\n");
const files = ["README.md", "src/app.ts", "src/app.test.ts", "contracts/Pool.t.sol", "tests/test_api.py"].map((p) => ({ path: p, bytes: fs.statSync(path.join(dir, p)).size }));

test("only public github.com https repo links are accepted", async () => {
  assert.ok(GITHUB_REPO.test("https://github.com/team/project"));
  for (const bad of ["http://github.com/a/b", "https://gitlab.com/a/b", "file:///etc", "https://github.com/a", "git@github.com:a/b.git", "https://github.com/a/b/../../x"]) {
    assert.ok(!GITHUB_REPO.test(bad), bad);
  }
  await assert.rejects(cloneRepo("file:///etc/passwd", path.join(dir, "x")), /Only public/);
});

test("refs must be a real file and a real line inside the repo", () => {
  assert.ok(refExists(dir, "src/app.ts:2"));
  assert.ok(refExists(dir, "src/app.ts:1-2"));
  assert.ok(!refExists(dir, "src/app.ts:99"));
  assert.ok(!refExists(dir, "src/missing.ts:1"));
  assert.ok(!refExists(dir, "../../../etc/passwd:1"));
  assert.ok(!refExists(dir, "/etc/passwd:1"));
  assert.ok(!refExists(dir, "src/app.ts"));
});

test("tests are counted by reading, never run", () => {
  assert.deepEqual(countTests(dir, files), { jsFiles: 1, jsCases: 3, solFiles: 1, solTests: 2, pyFiles: 1, pyTests: 1 });
});

test("context pack is line-numbered, README first, and bounded", () => {
  const pack = contextPack(dir, files, { maxChars: 100000 });
  assert.equal(pack.included[0], "README.md");
  assert.match(pack.text, /## src\/app\.ts\n {3}1\| export const a = 1;/);
  const tiny = contextPack(dir, files, { maxChars: 400 });
  assert.ok(tiny.chars <= 400 + 200 && tiny.notIncluded > 0);
});
