import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { services, shell, win32 } from "../src";

describe.skipIf(process.platform !== "win32")("win32", () => {
  test("version reports Windows 10.0", () => {
    const v = win32.version();
    expect(v.major).toBe(10);
    expect(v.build).toBeGreaterThan(19000);
    expect(v.isWindows11).toBe(v.build >= 22000);
  });

  test("processes lists this process with its path", () => {
    const self = win32.processes().find(p => p.pid === process.pid);
    expect(self?.name.toLowerCase()).toBe("bun.exe");
    expect(self?.parentPid).toBeGreaterThan(0);
    expect(win32.processPath(process.pid)?.toLowerCase()).toBe(process.execPath.toLowerCase());
    expect(win32.processPath(4_294_967_000)).toBeNull();
  });

  test("memory, drives, uptime and elevation answer", () => {
    expect(win32.memory().totalPhys).toBeGreaterThan(1n << 30n);
    expect(win32.drives()).toContain("C:");
    expect(win32.uptimeMs()).toBeGreaterThan(0n);
    expect(typeof win32.isElevated()).toBe("boolean");
  });
});

describe.skipIf(process.platform !== "win32")("shell known folders", () => {
  test("resolve to existing folders", () => {
    expect(shell.knownFolder("Profile").toLowerCase()).toBe(homedir().toLowerCase());
    expect(shell.knownFolder("Windows").toLowerCase()).toBe((process.env.SystemRoot ?? "").toLowerCase());
    expect(existsSync(shell.knownFolder("LocalAppData"))).toBe(true);
    expect(shell.knownFolder("B4BFCC3A-DB2C-424C-B029-7FE99A87C641")).toBe(shell.knownFolder("Desktop"));
  });

  test("rejects a malformed GUID", () => {
    expect(() => shell.knownFolder("not-a-guid")).toThrow(TypeError);
  });
});

describe.skipIf(process.platform !== "win32")("services (read-only)", () => {
  test("enumerates services and finds the RPC service running", () => {
    const all = services.list();
    expect(all.length).toBeGreaterThan(50);
    const rpc = all.find(s => s.name === "RpcSs");
    expect(rpc?.state).toBe("running");
    expect(rpc?.pid).toBeGreaterThan(0);
  });

  test("get answers for a known and an unknown service", () => {
    expect(services.get("RpcSs")?.state).toBe("running");
    expect(services.get("aphrody-no-such-service")).toBeNull();
  });
});

describe.skipIf(process.platform !== "win32")("volumes", () => {
  test("C: is a fixed volume with capacity", () => {
    const c = win32.volumes().find(v => v.root === "C:\\");
    expect(c?.type).toBe("fixed");
    expect(c!.totalBytes).toBeGreaterThan(c!.freeBytes);
  });
});
