// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectApk, plan, toWslPath } from "../src/apk.ts";

const dir = mkdtempSync(join(tmpdir(), "bunos-apk-"));

/** A minimal but valid zip with one stored file `name` -> `data`. */
function zip(file: string, name: string, data: string): string {
  const nameBytes = Buffer.from(name, "utf8");
  const content = Buffer.from(data, "utf8");
  // Local file header (no compression, no data descriptor, zero CRC — enough for a structural scan).
  const local = Buffer.alloc(30 + nameBytes.length + content.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  content.copy(local, 30 + nameBytes.length);
  // Central directory header.
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42); // offset of local header
  nameBytes.copy(central, 46);
  // End of central directory.
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  const p = join(dir, file);
  writeFileSync(p, Buffer.concat([local, central, eocd]));
  return p;
}

test("inspectApk recognises a zip with AndroidManifest.xml", () => {
  const apk = zip("app.apk", "AndroidManifest.xml", "x");
  const info = inspectApk(apk);
  expect(info.isZip).toBe(true);
  expect(info.hasManifest).toBe(true);
});

test("inspectApk rejects a non-zip and a zip without manifest", () => {
  writeFileSync(join(dir, "plain.bin"), "not a zip");
  expect(inspectApk(join(dir, "plain.bin")).isZip).toBe(false);
  const other = zip("other.zip", "readme.txt", "hi");
  expect(inspectApk(other).hasManifest).toBe(false);
});

test("install plan uses Waydroid under the Bun OS WSL distro", () => {
  const steps = plan({ file: "C:/tmp/a.apk", bytes: 1, isZip: true, hasManifest: true, packageName: "com.example.app" });
  expect(steps.some(s => s.includes("waydroid") && s.includes("install"))).toBe(true);
  expect(steps.at(-1)).toContain("com.example.app");
});

test("toWslPath maps a Windows path to /mnt", () => {
  expect(toWslPath("C:\\Users\\x\\a.apk")).toBe("/mnt/c/Users/x/a.apk");
});
