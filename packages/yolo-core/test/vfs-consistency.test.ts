// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDirectory } from "../src/vfs/scan";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yolo-scan-consistency-"));
  roots.push(root);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "z.ts"), "z".repeat(200000));
  writeFileSync(join(root, "a.ts"), "aa");
  writeFileSync(join(root, "nested/b.md"), "bb");
  writeFileSync(join(root, "binary.bin"), new Uint8Array([255, 1]));
  return root;
}
test("tree and report ordering stay stable across parallel I/O and bounded file selection", async () => {
  const root = fixture();
  const sequential = await scanDirectory(root, { parallel: 1 });
  const parallel = await scanDirectory(root, { parallel: 16 });
  const repeated = await scanDirectory(root, { parallel: 16 });
  expect(parallel.treeFingerprint).toBe(sequential.treeFingerprint);
  expect(repeated.treeFingerprint).toBe(sequential.treeFingerprint);
  expect(parallel.largestFiles).toEqual(sequential.largestFiles);
  expect(parallel.byExtension).toEqual(sequential.byExtension);
  const bounded = await scanDirectory(root, { parallel: 16, maxFiles: 1 });
  expect(bounded.largestFiles.map(entry => entry.path)).toEqual(["a.ts"]);
  expect(bounded.treeFingerprint).toBe((await scanDirectory(root, { parallel: 1, maxFiles: 1 })).treeFingerprint);
});
test("raw non-UTF8 content changes alter the fingerprint even at equal byte size", async () => {
  const root = fixture();
  const first = await scanDirectory(root, { exts: ["bin"] });
  expect(first.largestFiles[0]?.hash).toBe(Bun.hash.wyhash(new Uint8Array([255, 1])).toString(16));
  writeFileSync(join(root, "binary.bin"), new Uint8Array([254, 1]));
  const second = await scanDirectory(root, { exts: ["bin"] });
  expect(second.totalBytes).toBe(first.totalBytes);
  expect(second.treeFingerprint).not.toBe(first.treeFingerprint);
});
test("native scan API rejects invalid directories and worker/file bounds", async () => {
  const root = fixture();
  await expect(scanDirectory(join(root, "a.ts"))).rejects.toThrow("not a directory");
  await expect(scanDirectory(root, { parallel: Number.NaN })).rejects.toThrow("positive integer");
  await expect(scanDirectory(root, { parallel: 0 })).rejects.toThrow("positive integer");
  await expect(scanDirectory(root, { maxFiles: -1 })).rejects.toThrow("positive integer");
});
