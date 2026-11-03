// SPDX-License-Identifier: MIT
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dotnet, { DotnetError } from "../src/dotnet/dotnet.ts";
import { compareVersions, pickFramework } from "../src/dotnet/hostfxr.ts";
import plugin from "../src/dotnet/plugin.ts";

const installed = (() => {
  try {
    return dotnet.locate();
  } catch {
    return null;
  }
})();
const hasSdk = Boolean(installed?.sdks.length && installed.muxer);

test("versions compare like the .NET host", () => {
  expect(compareVersions("8.0.10", "8.0.9")).toBeGreaterThan(0);
  expect(compareVersions("10.0.0-rc.1", "10.0.0")).toBeLessThan(0);
  expect(compareVersions("10.0.0-rc.10", "10.0.0-rc.2")).toBeGreaterThan(0);
});

test("framework roll-forward follows the documented policies", () => {
  const versions = ["6.0.5", "8.0.1", "8.0.23", "8.1.4", "9.0.0", "10.0.0-rc.1", "10.0.12"];
  expect(pickFramework("8.0.0", versions)).toBe("8.0.23");
  expect(pickFramework("8.0.0", versions, "Minor", false)).toBe("8.0.1");
  expect(pickFramework("8.0.30", versions, "Minor")).toBe("8.1.4");
  expect(pickFramework("8.2.0", versions, "Minor")).toBeNull();
  expect(pickFramework("8.2.0", versions, "Major")).toBe("9.0.0");
  expect(pickFramework("8.0.0", versions, "LatestMinor")).toBe("8.1.4");
  expect(pickFramework("8.0.0", versions, "LatestMajor")).toBe("10.0.12");
  expect(pickFramework("8.0.1", versions, "Disable")).toBe("8.0.1");
  expect(pickFramework("8.0.2", versions, "Disable")).toBeNull();
  expect(pickFramework("10.0.0-rc.1", versions, "LatestPatch")).toBe("10.0.12");
});

test("argument validation and missing installs raise typed errors", () => {
  expect(() => dotnet.functionPointer(null as never)).toThrow(TypeError);
  expect(() => dotnet.locate(join(tmpdir(), "no-dotnet-here"))).toThrow(DotnetError);
});

test("the plugin serves bun:dotnet", () => {
  expect(plugin.spec.modules?.["bun:dotnet"]).toBeDefined();
  expect(plugin.spec.replaces).toContain("bun:dotnet");
});

describe.skipIf(installed === null)("with an installed .NET", () => {
  test("locate, info, env and resolve describe the install", () => {
    const location = dotnet.locate();
    expect(existsSync(location.hostfxr)).toBe(true);
    expect(location.runtimes.length).toBeGreaterThan(0);
    const report = dotnet.info();
    expect(report.primary).toBe(location.dotnetRoot);
    expect(report.installs.some(install => install.root === location.dotnetRoot)).toBe(true);
    const snapshot = dotnet.env();
    expect(snapshot.env.DOTNET_ROOT).toBe(location.dotnetRoot);
    expect(dotnet.env()).toBe(snapshot);
    const dir = mkdtempSync(join(tmpdir(), "bun-dotnet-resolve-"));
    const config = join(dir, "app.runtimeconfig.json");
    const major = location.runtimes.at(-1)!.split(".")[0];
    writeFileSync(
      config,
      JSON.stringify({ runtimeOptions: { framework: { name: "Microsoft.NETCore.App", version: `${major}.0.0` } } }),
    );
    const frameworks = dotnet.resolve(config) as { frameworks: { resolved: { version: string } | null }[] };
    expect(frameworks.frameworks[0]!.resolved?.version.startsWith(`${major}.`)).toBe(true);
  });

  test.skipIf(!hasSdk)("resolve selects the SDK through hostfxr_resolve_sdk2", () => {
    const resolution = dotnet.resolve() as { sdk: { version: string } | null };
    expect(installed!.sdks).toContain(resolution.sdk!.version);
  });
});

describe.skipIf(!hasSdk)("hosting the CLR in the Bun process", () => {
  let assembly = "";

  beforeAll(async () => {
    const out = mkdtempSync(join(tmpdir(), "bun-dotnet-fixture-"));
    const project = join(import.meta.dir, "fixtures", "dotnet", "BunDotnetFixture.csproj");
    const result = await dotnet.build([project, "-c", "Release", "-o", out]);
    if (result.exitCode !== 0) throw new Error(`dotnet build failed:\n${result.stdout}\n${result.stderr}`);
    assembly = join(out, "BunDotnetFixture.dll");
  }, 180_000);

  test("unmanaged calls an [UnmanagedCallersOnly] method; delegate types and loadAssembly work", () => {
    expect(dotnet.runtimeConfig()).toBeNull();
    const config = assembly.replace(/\.dll$/, ".runtimeconfig.json");
    expect(dotnet.initialize(config)).toBe(0);
    expect(dotnet.initialize()).toBe(1);
    expect(dotnet.runtimeConfig()).toBe(config);
    const add = dotnet.unmanaged(
      { assembly, type: "BunDotnetFixture.Exports, BunDotnetFixture", method: "Add" },
      { args: ["i32", "i32"], returns: "i32" },
    );
    expect(add(20, 22)).toBe(42);
    dotnet.loadAssembly(assembly);
    const pid = dotnet.unmanaged(
      { type: "BunDotnetFixture.Exports, BunDotnetFixture", method: "ProcessId" },
      { returns: "i32" },
    );
    expect(pid()).toBe(process.pid);
    const multiply = dotnet.unmanaged(
      {
        assembly,
        type: "BunDotnetFixture.Exports, BunDotnetFixture",
        method: "Multiply",
        delegateType: "BunDotnetFixture.Exports+BinaryDelegate, BunDotnetFixture",
      },
      { args: ["i32", "i32"], returns: "i32" },
    );
    expect(multiply(6, 7)).toBe(42);
    expect(() =>
      dotnet.functionPointer({ assembly, type: "BunDotnetFixture.Exports, BunDotnetFixture", method: "Missing" }),
    ).toThrow(DotnetError);
  });
});
