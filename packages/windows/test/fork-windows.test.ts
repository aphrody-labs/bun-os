// SPDX-License-Identifier: Apache-2.0
// bun:windows on upstream Bun (src/fork/windows.ts), ported from the fork's test/js/bun/windows/windows.test.ts for
// the members Bun OS carries.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import windows from "../src/fork/windows";

const isWindows = process.platform === "win32";

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe.skipIf(isWindows)("non-Windows", () => {
  test("reports unsupported and throws", () => {
    expect(windows.isSupported).toBe(false);
    expect(windows.isWindows11()).toBe(false);
    expect(errorCode(() => windows.version())).toBe("ERR_BUN_WINDOWS_UNSUPPORTED");
    expect(errorCode(() => windows.registry.get("HKCU\\Software"))).toBe("ERR_BUN_WINDOWS_UNSUPPORTED");
    expect(errorCode(() => windows.memory.status())).toBe("ERR_BUN_WINDOWS_UNSUPPORTED");
    expect(errorCode(() => windows.processes.setPriority(0, "normal"))).toBe("ERR_BUN_WINDOWS_UNSUPPORTED");
    // Pure byte parsing (no Win32 dependency) still works off Windows.
    expect(windows.pe.looksLikePe(new Uint8Array([0x4d, 0x5a]))).toBe(true);
    expect(windows.pe.looksLikePe(new Uint8Array([0, 0]))).toBe(false);
  });
});

describe.skipIf(!isWindows)("bun:windows", () => {
  test("version", () => {
    const v = windows.version();
    expect(v.major).toBe(10);
    expect(v.build).toBeGreaterThan(0);
    expect(v.version).toBe(`${v.major}.${v.minor}.${v.build}.${v.ubr}`);
    expect(v.isWindows11).toBe(v.build >= 22000);
    expect(windows.isWindows11()).toBe(v.isWindows11);
    if (v.isWindows11 && v.installationType === "Client") expect(v.productName).toContain("Windows 11");
    expect(v.nativeArch).toBe(process.arch);
    expect(windows.version()).toBe(v);
  });

  test("systemInfo and isElevated", () => {
    const info = windows.systemInfo();
    expect(info.processors).toBeGreaterThan(0);
    expect(info.totalMemory).toBeGreaterThan(info.freeMemory);
    expect(info.computerName.length).toBeGreaterThan(0);
    expect(info.userName.length).toBeGreaterThan(0);
    expect(info.uptime).toBeGreaterThan(0);
    expect(["dark", "light"]).toContain(info.theme);
    expect(typeof windows.isElevated()).toBe("boolean");
  });

  test("physical, page-file and virtual memory status", () => {
    const memory = windows.memory.status();
    expect(memory.totalPhysical).toBeGreaterThan(0);
    expect(memory.availablePhysical).toBeLessThanOrEqual(memory.totalPhysical);
    expect(memory.totalPageFile).toBeGreaterThan(0);
    expect(memory.availablePageFile).toBeLessThanOrEqual(memory.totalPageFile);
    expect(memory.memoryLoad).toBeGreaterThanOrEqual(0);
    expect(memory.memoryLoad).toBeLessThanOrEqual(100);
  });

  test("registry round-trip", () => {
    const key = `HKCU\\Software\\BunTest-${process.pid}`;
    const { registry } = windows;
    try {
      registry.set(key, "sz", "héllo");
      registry.set(key, "dword", 42);
      registry.set(key, "qword", 2n ** 40n);
      registry.set(key, "multi", ["a", "b"]);
      registry.set(key, "bin", new Uint8Array([1, 2, 255]));
      registry.set(key, "expand", "%SystemRoot%", "REG_EXPAND_SZ");
      registry.createKey(`${key}\\child`);

      expect(registry.get(key, "sz")).toEqual({ type: "REG_SZ", value: "héllo" });
      expect(registry.get(key, "dword")).toEqual({ type: "REG_DWORD", value: 42 });
      expect(registry.get(key, "qword")).toEqual({ type: "REG_QWORD", value: 2n ** 40n });
      expect(registry.get(key, "multi")).toEqual({ type: "REG_MULTI_SZ", value: ["a", "b"] });
      expect(registry.get(key.replace("HKCU", "HKEY_CURRENT_USER"), "bin")).toEqual({
        type: "REG_BINARY",
        value: Buffer.from([1, 2, 255]),
      });
      expect(registry.get(key, "expand")).toEqual({ type: "REG_EXPAND_SZ", value: "%SystemRoot%" });
      expect(registry.get(key, "sz", { view: 64 })).toEqual({ type: "REG_SZ", value: "héllo" });
      expect(registry.get(key, "missing")).toBeNull();
      expect(registry.get(`${key}\\missing`, "x")).toBeNull();

      const listing = registry.list(key)!;
      expect(listing.keys).toEqual(["child"]);
      expect(listing.values.map(v => v.name).sort()).toEqual(["bin", "dword", "expand", "multi", "qword", "sz"]);

      expect(registry.deleteValue(key, "sz")).toBe(true);
      expect(registry.deleteValue(key, "sz")).toBe(false);
      expect(registry.list(`${key}\\missing`)).toBeNull();
      // Without { recursive: true } a key with subkeys stays.
      expect(() => registry.deleteKey(key)).toThrow("subkeys");
      expect(registry.list(key)).not.toBeNull();
    } finally {
      registry.deleteKey(key, { recursive: true });
    }
    expect(registry.get(key, "dword")).toBeNull();
    expect(registry.deleteKey(key)).toBe(false);
  });

  test("registry argument validation", () => {
    expect(errorCode(() => windows.registry.get("HKXX\\Software"))).toBe("ERR_INVALID_ARG_VALUE");
    expect(errorCode(() => windows.registry.set("HKCU\\Software\\x", "v", -1))).toBe("ERR_OUT_OF_RANGE");
    expect(errorCode(() => windows.registry.set("HKCU\\Software\\x", "v", {} as never))).toBe("ERR_INVALID_ARG_TYPE");
    expect(errorCode(() => windows.registry.deleteKey("HKCU"))).toBe("ERR_INVALID_ARG_VALUE");
  });

  test("known folders", () => {
    const docs = windows.knownFolder("Documents");
    expect(docs).toBe(windows.knownFolder(`{${windows.knownFolders.Documents}}`));
    expect(windows.knownFolder("Windows").toLowerCase()).toBe(process.env.SystemRoot!.toLowerCase());
    expect(() => windows.knownFolder("not-a-guid")).toThrow();
  });

  test("processes", () => {
    const self = windows.processes.list().find(p => p.pid === process.pid);
    expect(self).toBeDefined();
    expect(self!.threads).toBeGreaterThan(0);
    expect(self!.ppid).toBeGreaterThan(0);
    expect(windows.processes.path(process.pid)!.toLowerCase()).toBe(process.execPath.toLowerCase());
  });

  test("process controls", async () => {
    const pid = process.pid;
    windows.processes.setPriority(pid, "below-normal");
    windows.processes.setPriority(pid, "normal");
    windows.processes.setEcoMode(pid, true);
    windows.processes.setEcoMode(pid, false);
    windows.processes.trimWorkingSet(pid);
    expect(errorCode(() => windows.processes.setAffinity(pid, 0))).toBe("ERR_OUT_OF_RANGE");
    expect(errorCode(() => windows.processes.setPriority(pid, "invalid" as never))).toBe("ERR_INVALID_ARG_VALUE");
    const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdout: "ignore" });
    windows.processes.terminate(child, 7);
    expect(await child.exited).toBe(7);
  });

  test("services", () => {
    const svc = windows.services.get("EventLog")!;
    expect(svc.name).toBe("EventLog");
    expect(svc.state).toBe("running");
    expect(svc.pid).toBeGreaterThan(0);
    expect(windows.services.get("bun-no-such-service")).toBeNull();
    expect(windows.services.list().some(s => s.name.toLowerCase() === "eventlog")).toBe(true);
  });

  test("clipboard round-trip", () => {
    let previous: string | null;
    try {
      previous = windows.clipboard.readText();
    } catch {
      // No interactive desktop (service session): nothing to test.
      return;
    }
    try {
      windows.clipboard.writeText("bun:windows ✓");
      expect(windows.clipboard.readText()).toBe("bun:windows ✓");
      windows.clipboard.clear();
      expect(windows.clipboard.readText()).toBeNull();
    } finally {
      if (previous !== null) windows.clipboard.writeText(previous);
    }
  });

  test("pe: parses kernel32.dll (headers, exports, signature)", () => {
    const path = `${process.env.SystemRoot}\\System32\\kernel32.dll`;
    const bytes = new Uint8Array(readFileSync(path));
    expect(windows.pe.looksLikePe(bytes)).toBe(true);
    const info = windows.pe.parse(bytes, "kernel32.dll")!;
    expect(info.kind).toBe("dll");
    expect(info.bits === 32 || info.bits === 64).toBe(true);
    expect(["x86", "x64", "arm64", "arm64ec"]).toContain(info.machine);
    expect(info.isDotnet).toBe(false);
    expect(info.exports.some(e => e.name === "CreateFileW")).toBe(true);
    expect(info.exportName?.toLowerCase()).toBe("kernel32.dll");
    expect(info.warnings).toEqual([]);
    expect(windows.pe.apiSetKey("api-ms-win-core-file-l1-2-4.dll")).toBe("api-ms-win-core-file-l1-2");
  });

  test("pe: authenticode.parse rejects non-PKCS#7 bytes without a confusing error", () => {
    expect(windows.pe.authenticode.parse(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(errorCode(() => windows.pe.authenticode.parse("not bytes" as never))).toBe("ERR_INVALID_ARG_TYPE");
  });
});
