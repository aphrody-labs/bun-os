import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parsePe } from "../src/pe";
import { processes, registry, storage } from "../src/win";

test("parsePe rejects bytes that are not a PE image", () => {
  expect(parsePe(new TextEncoder().encode("not an executable".repeat(8)))).toBeNull();
});

test.skipIf(process.platform !== "win32")("parsePe reads the running Bun executable", () => {
  const info = parsePe(readFileSync(process.execPath));
  expect(info).not.toBeNull();
  expect(info).toMatchObject({ kind: "exe", bits: 64, isDotnet: false });
  expect(info!.imports.some(entry => /kernel32/i.test(entry.module))).toBe(true);
  expect(info!.version?.strings.ProductName).toBe("Bun");
});

test.skipIf(process.platform !== "win32")("registry, processes and drives answer on Windows", () => {
  const key = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion`;
  expect(registry.list(key).keys).toContain("Explorer");
  expect(registry.get(key, "no-such-value")).toBeNull();
  expect(processes.list().some(entry => entry.pid === process.pid)).toBe(true);
  expect(storage.drives().some(drive => drive.type === "fixed" && drive.totalBytes > 0)).toBe(true);
});
