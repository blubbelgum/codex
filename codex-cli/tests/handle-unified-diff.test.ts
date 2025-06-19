import { applySearchReplaceDiff } from "../src/utils/agent/handle-unified-diff.js";
import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tempDir: string;
let testFile: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  testFile = path.join(tempDir, "test.txt");
});

afterEach(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("applySearchReplaceDiff - simple replacement", () => {
  const original = "hello world\nthis is a test\ngoodbye";
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
this is a test
=======
this is updated
+++++++ REPLACE`;

  const result = applySearchReplaceDiff(testFile, diff);
  
  expect(result).toContain("Successfully applied 1 search/replace operation");
  
  const updated = fs.readFileSync(testFile, 'utf8');
  expect(updated).toBe("hello world\nthis is updated\ngoodbye");
});

test("applySearchReplaceDiff - multiple replacements", () => {
  const original = "line1\nline2\nline3\nline4";
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
line1
=======
updated line1
+++++++ REPLACE

------- SEARCH
line3
=======
updated line3
+++++++ REPLACE`;

  const result = applySearchReplaceDiff(testFile, diff);
  
  expect(result).toContain("Successfully applied 2 search/replace operation");
  
  const updated = fs.readFileSync(testFile, 'utf8');
  expect(updated).toBe("updated line1\nline2\nupdated line3\nline4");
});

test("applySearchReplaceDiff - multiline content", () => {
  const original = `function test() {
  console.log("old");
  return false;
}`;
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
  console.log("old");
  return false;
=======
  console.log("new");
  return true;
+++++++ REPLACE`;

  const result = applySearchReplaceDiff(testFile, diff);
  
  expect(result).toContain("Successfully applied 1 search/replace operation");
  
  const updated = fs.readFileSync(testFile, 'utf8');
  expect(updated).toBe(`function test() {
  console.log("new");
  return true;
}`);
});

test("applySearchReplaceDiff - search content not found", () => {
  const original = "hello world";
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
nonexistent content
=======
replacement
+++++++ REPLACE`;

  expect(() => {
    applySearchReplaceDiff(testFile, diff);
  }).toThrow(/Search content not found in file/);
});

test("applySearchReplaceDiff - empty line replacement", () => {
  const original = "hello\n\nworld";
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
hello

world
=======
hello
new line
world
+++++++ REPLACE`;

  const result = applySearchReplaceDiff(testFile, diff);
  
  expect(result).toContain("Successfully applied 1 search/replace operation");
  
  const updated = fs.readFileSync(testFile, 'utf8');
  expect(updated).toBe("hello\nnew line\nworld");
});

test("applySearchReplaceDiff - delete content", () => {
  const original = "keep this\ndelete this\nkeep this too";
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
delete this
=======
+++++++ REPLACE`;

  const result = applySearchReplaceDiff(testFile, diff);
  
  expect(result).toContain("Successfully applied 1 search/replace operation");
  
  const updated = fs.readFileSync(testFile, 'utf8');
  expect(updated).toBe("keep this\n\nkeep this too");
});

test("applySearchReplaceDiff - legacy format support", () => {
  const original = "old content";
  fs.writeFileSync(testFile, original);

  const diff = `<<< SEARCH
old content
===
new content
>>> REPLACE`;

  const result = applySearchReplaceDiff(testFile, diff);
  
  expect(result).toContain("Successfully applied 1 search/replace operation");
  
  const updated = fs.readFileSync(testFile, 'utf8');
  expect(updated).toBe("new content");
});

test("applySearchReplaceDiff - invalid format", () => {
  const original = "content";
  fs.writeFileSync(testFile, original);

  const diff = `invalid format`;

  expect(() => {
    applySearchReplaceDiff(testFile, diff);
  }).toThrow(/No SEARCH\/REPLACE blocks found/);
});

test("applySearchReplaceDiff - incomplete block", () => {
  const original = "content";
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
content
=======`;

  expect(() => {
    applySearchReplaceDiff(testFile, diff);
  }).toThrow(/Incomplete SEARCH\/REPLACE block/);
});

test("applySearchReplaceDiff - file not found", () => {
  const nonExistentFile = path.join(tempDir, "nonexistent.txt");

  const diff = `------- SEARCH
content
=======
new content
+++++++ REPLACE`;

  expect(() => {
    applySearchReplaceDiff(nonExistentFile, diff);
  }).toThrow(/File does not exist/);
});

test("applySearchReplaceDiff - exact whitespace matching", () => {
  const original = "  indented line\n    more indented";
  fs.writeFileSync(testFile, original);

  const diff = `------- SEARCH
  indented line
=======
  updated line
+++++++ REPLACE`;

  const result = applySearchReplaceDiff(testFile, diff);
  
  expect(result).toContain("Successfully applied 1 search/replace operation");
  
  const updated = fs.readFileSync(testFile, 'utf8');
  expect(updated).toBe("  updated line\n    more indented");
}); 