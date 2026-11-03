// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { gateFailures, identity, normalize, peResourceTypes, uninstallEntry } from "../src/windows.ts";
import { existsSync, readFileSync } from "node:fs";

test("normalize reads the four schema-1 manifest shapes", () => {
  const shell = normalize({ schema: 1, component: "bunos-shell", repoRev: "abc", files: [{ path: "C:\\a.exe", sha256: "1", size: 2 }] }, "shell");
  expect(shell.component).toBe("bunos-shell");
  expect(shell.revision).toBe("abc");
  expect(shell.uninstall.length).toBeGreaterThan(0);
  const nt = normalize({ kind: "bunos-windows-nt", service: "BunOSWinBridge", bundle: { revision: "r" }, files: [{ path: "p", kind: "file", bytes: 3, signer: "T" }, { path: "d", kind: "dir" }] }, "nt");
  expect(nt.component).toBe("nt");
  expect(nt.services).toEqual(["BunOSWinBridge"]);
  expect(nt.files).toHaveLength(1);
  expect(nt.files[0]!.size).toBe(3);
  expect(normalize({ kind: "bunos-windows-userland-install", files: [{ path: "x", kind: "payload" }] }, "userland").component).toBe("userland");
  expect(normalize({ kind: "bunos-windows-wsl", component: "wsl", files: [] }, "wsl").uninstall.join(" ")).toContain("setup-elevated.ps1");
});

test("the replace gate stays closed until every condition holds", () => {
  const gate = { crashFreeDays: 14, maxStartupMs: 1500, idleCpuPct: 0.5, privateMB: 80 };
  const app = { title: "t", switch: { kind: "shell-component", component: "files-default" } as const, parity: ["Recycle Bin"] };
  const now = Date.parse("2026-12-01T00:00:00Z");
  expect(gateFailures(app, gate, {}, now).length).toBeGreaterThanOrEqual(4);
  const ok = { since: "2026-11-03T00:00:00Z", startupMs: 900, idleCpuPct: 0.1, privateMB: 40, parity: { "Recycle Bin": true } };
  expect(gateFailures(app, gate, ok, now)).toEqual([]);
  expect(gateFailures(app, gate, { ...ok, lastCrash: "2026-11-30T00:00:00Z" }, now).join()).toContain("crash-free");
  expect(gateFailures({ ...app, switch: { kind: "none", reason: "r" } }, gate, ok, now).join()).toContain("no switch");
});

test("the uninstall entry carries icon, publisher, version and a bunos command", () => {
  const e = uninstallEntry("1.4.7", "C:\\Windows\\BunOS");
  expect(e.Publisher!.value).toBe("Aphrody");
  expect(e.DisplayVersion!.value).toBe("1.4.7");
  expect(e.DisplayIcon!.value.endsWith("bunos.exe,0")).toBe(true);
  expect(e.UninstallString!.value).toContain("windows uninstall --all --yes");
});

test("identity reads PE resources: a system exe has icon and version, a text file is not a PE", () => {
  const notepad = "C:\\Windows\\System32\\notepad.exe";
  if (process.platform === "win32" && existsSync(notepad)) {
    const t = peResourceTypes(new Uint8Array(readFileSync(notepad)))!;
    expect(t.has(16)).toBe(true);
    expect(identity(notepad).ok).toBe(true);
  }
  expect(peResourceTypes(new Uint8Array([1, 2, 3]))).toBeNull();
});
