// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { layout } from "../src/paths.ts";

const built = process.platform === "win32" && existsSync(layout().native);
const cppBuilt = process.platform === "win32" && existsSync(layout().cpp);

describe.skipIf(!built)("bunos_windows.dll (C# Native AOT)", () => {
  test("ABI, ping and version", async () => {
    const native = await import("../src/native.ts");
    expect(native.abi()).toBe(native.ABI);
    expect(native.ping(41n)).toBe(42n);
    const version = native.version();
    expect(version.nativeAot).toBe(true);
    expect(native.methods()).toContain("winget.search");
  });

  test("system.info through CsWinRT and CsWin32", async () => {
    const { systemInfo } = await import("../src/d3d12.ts");
    const info = systemInfo();
    expect(info.profile!.deviceFamily).toBe("Windows.Desktop");
    expect(Number(info.win32!.logicalProcessors)).toBeGreaterThan(0);
  });

  test("DXGI adapters with D3D12 tiers", async () => {
    const { adapters } = await import("../src/d3d12.ts");
    const list = adapters();
    expect(list.length).toBeGreaterThan(0);
    // WARP (Microsoft Basic Render Driver) is always present and supports D3D12.
    expect(list.some(a => a.d3d12?.supported)).toBe(true);
  }, 30_000);

  test("unknown methods fail with EINVAL", async () => {
    const { call, WindowsCallError } = await import("../src/native.ts");
    expect(() => call("nope")).toThrow(WindowsCallError);
  });

  test("winget sources through the COM API", async () => {
    const winget = await import("../src/winget.ts");
    const sources = await winget.sources();
    expect(sources.some(s => s.name === "winget")).toBe(true);
  }, 60_000);
});

describe.skipIf(!cppBuilt)("bunos_win_cpp.dll (C++)", () => {
  test("adapters and WinRT profile", async () => {
    const native = await import("../src/native.ts");
    const { adapters, systemProfile } = await import("../src/d3d12.ts");
    expect(native.cppPing(1n)).toBe(2n);
    expect(adapters({ via: "cpp" }).length).toBeGreaterThan(0);
    expect(systemProfile().deviceFamily).toBe("Windows.Desktop");
  }, 30_000);
});
