// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNativeShellOwner,
  assertPrivateOwnerWorkspace,
  ownerM3Version,
  PRIVATE_OWNER_ROOT,
  TEMPLATES,
  webFiles,
  writeFiles,
} from "../src/index";

test("canonical Bun OS array workspace admits only a declared flat app", () => {
  expect(() => assertPrivateOwnerWorkspace(join(PRIVATE_OWNER_ROOT, "apps/m3-showcase"))).not.toThrow();
  for (const destination of [
    PRIVATE_OWNER_ROOT,
    join(PRIVATE_OWNER_ROOT, "packages/m3"),
    join(PRIVATE_OWNER_ROOT, "apps/m3-showcase/nested"),
    join(PRIVATE_OWNER_ROOT, "apps/not-a-declared-scaffold-owner"),
    join(PRIVATE_OWNER_ROOT, "../outside"),
  ]) {
    expect(() => assertPrivateOwnerWorkspace(destination)).toThrow(/private owner workspace required/);
  }
});

test("web template uses the real canonical version and rejects unacquired versions", () => {
  const manifest = JSON.parse(readFileSync(join(PRIVATE_OWNER_ROOT, "packages/m3/package.json"), "utf8"));
  expect(ownerM3Version()).toBe(manifest.version);
  const files = webFiles({ name: "demo", m3Version: ownerM3Version() });
  expect(files["package.json"]).toContain('"@aphrody/m3": "workspace:*"');
  expect(() => webFiles({ name: "demo", m3Version: "not-the-owner-version" })).toThrow(
    /source acquisition is required/,
  );
  expect(TEMPLATES.map(template => template.name)).toEqual(["web", "app", "example"]);
  expect(() => assertNativeShellOwner("tauri")).toThrow(/canonical registered Aphrody Rust shell owner/);
});

test("writer refuses escapes, overwrites and junction traversal before any write", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "bun-os-scaffold-guard-"));
  try {
    const output = join(temporary, "output");
    const outside = join(temporary, "outside");
    mkdirSync(output);
    mkdirSync(outside);
    writeFileSync(join(output, "existing.txt"), "retained");
    await expect(writeFiles(output, { "existing.txt": "changed" }, "empty")).rejects.toThrow(/not empty/);
    await expect(writeFiles(output, { "existing.txt": "changed" }, "merge")).rejects.toThrow(/overwrite/);
    await expect(writeFiles(output, { "../escape.txt": "unsafe" }, "merge")).rejects.toThrow(/unsafe path/);
    symlinkSync(outside, join(output, "redirect"), process.platform === "win32" ? "junction" : "dir");
    await expect(writeFiles(output, { "redirect/file.txt": "unsafe" }, "merge")).rejects.toThrow(/symbolic link/);
    expect(readFileSync(join(output, "existing.txt"), "utf8")).toBe("retained");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
