// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { yoloCliPath } from "../yolo-cli-path.ts";
import { runPathAudit } from "../../src/automation/path-audit.ts";

test("path audit is read-only by default and rewrites only safe code paths on apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "paths-owner-"));
  try {
    const source = join(root, "input.tsx");
    const content =
      'const a = "/tmp/example/file.txt";\nconst b = "/home/example/file.txt";\nconst c = <div title="/tmp/attribute.txt" />;\n';
    await writeFile(source, content);
    await mkdir(join(root, "node_modules"));
    const ignored = join(root, "node_modules", "ignored.ts");
    await writeFile(ignored, 'const path = "/tmp/ignored";\n');
    expect(await runPathAudit(["--root", root])).toBe(0);
    expect(await readFile(source, "utf8")).toBe(content);
    expect(await runPathAudit(["--root", root, "--apply"])).toBe(0);
    const rewritten = await readFile(source, "utf8");
    expect(rewritten).toContain('import { tempPath } from "@aphrody/paths"');
    expect(rewritten).toContain('tempPath("example", "file.txt")');
    expect(rewritten).toContain('"/home/example/file.txt"');
    expect(rewritten).toContain('title="/tmp/attribute.txt"');
    expect(await readFile(ignored, "utf8")).toBe('const path = "/tmp/ignored";\n');
    await runPathAudit(["--root", root, "--apply"]);
    expect(await readFile(source, "utf8")).toBe(rewritten);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Workspace operation advertises the path-audit command", () => {
  const output = Bun.spawnSync([process.execPath, yoloCliPath, "ops", "path-audit", "--help"], { windowsHide: true });
  expect(output.exitCode).toBe(0);
  expect(output.stdout.toString()).toContain("yolo ops path-audit");
});
