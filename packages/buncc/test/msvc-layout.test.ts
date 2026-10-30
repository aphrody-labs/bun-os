import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyEnv,
  computeEnv,
  fingerprint,
  formatEnv,
  interpretInstallerExit,
  parseVswhere,
  pickSdk,
  pickToolset,
  scanInstances,
  setupCommands,
  syncCache,
  windowsSdks,
  type Toolchain,
} from "../src/providers/msvc-layout.ts";

function fakeVs() {
  const root = mkdtempSync(join(tmpdir(), "buncc-vs-"));
  const pf86 = join(root, "pf86");
  const inst = join(pf86, "Microsoft Visual Studio", "2022", "BuildTools");
  for (const v of ["14.38.33130", "14.44.35207"]) {
    for (const d of ["include", join("lib", "x64"), join("lib", "arm64"), join("bin", "Hostx64", "x64")])
      mkdirSync(join(inst, "VC", "Tools", "MSVC", v, d), { recursive: true });
  }
  mkdirSync(join(inst, "VC", "Auxiliary", "Build"), { recursive: true });
  writeFileSync(join(inst, "VC", "Auxiliary", "Build", "Microsoft.VCToolsVersion.default.txt"), "14.38.33130\r\n");
  mkdirSync(join(inst, "Common7", "IDE"), { recursive: true });
  const kit = join(pf86, "Windows Kits", "10");
  for (const v of ["10.0.22621.0", "10.0.26100.0"]) {
    mkdirSync(join(kit, "Include", v, "um"), { recursive: true });
    writeFileSync(join(kit, "Include", v, "um", "Windows.h"), "");
    for (const d of ["ucrt", "shared", "winrt"]) mkdirSync(join(kit, "Include", v, d), { recursive: true });
    for (const d of ["um", "ucrt"]) mkdirSync(join(kit, "Lib", v, d, "x64"), { recursive: true });
    mkdirSync(join(kit, "bin", v, "x64"), { recursive: true });
  }
  mkdirSync(join(kit, "Include", "10.0.19041.0"), { recursive: true }); // header-less SDK is ignored
  return { root, env: { "ProgramFiles(x86)": pf86, ProgramFiles: join(root, "pf") }, inst, kit };
}

test("folder scan finds instances and toolsets follow the instance default", () => {
  const fx = fakeVs();
  try {
    const [instance] = scanInstances(fx.env);
    expect(instance.path).toBe(fx.inst);
    expect(pickToolset(instance)).toBe("14.38.33130");
    expect(pickToolset(instance, "14.44")).toBe("14.44.35207");
    expect(pickToolset(instance, "14.99")).toBeUndefined();
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("environment is computed from the layout and only lists existing directories", () => {
  const fx = fakeVs();
  try {
    const sdks = windowsSdks(fx.env, "x64");
    expect(sdks.map(s => s.version)).toEqual(["10.0.22621.0", "10.0.26100.0"]);
    expect(pickSdk(sdks, "10.0.22621")?.version).toBe("10.0.22621.0");
    const tc: Toolchain = {
      instance: scanInstances(fx.env)[0],
      toolset: "14.44.35207",
      sdk: pickSdk(sdks)!,
      arch: "x64",
      host: "x64",
    };
    const env = computeEnv(tc);
    expect(env.set.VCToolsVersion).toBe("14.44.35207");
    expect(env.set.WindowsSDKVersion).toBe("10.0.26100.0\\");
    expect(env.set.VSCMD_ARG_TGT_ARCH).toBe("x64");
    expect(env.prepend.LIB.some(d => d.endsWith(join("lib", "x64")))).toBe(true);
    expect(env.prepend.INCLUDE.every(d => !d.includes("cppwinrt"))).toBe(true);
    expect(env.prepend.PATH[0]).toContain("Hostx64");
    const merged = applyEnv({ PATH: "C:\\x" }, env);
    expect(merged.PATH.endsWith("C:\\x")).toBe(true);
    expect(formatEnv(env, "cmd")).toContain('set "VCToolsVersion=14.44.35207"');
    expect(formatEnv(env, "pwsh")).toContain("$env:Platform = 'x64'");
    expect(formatEnv(env, "sh")).toContain("export PATH='/");
    expect(formatEnv(env, "github", { PATH: "C:\\x" })).toContain("VCToolsVersion=14.44.35207");

    const cache = join(fx.root, "cache");
    expect(syncCache(tc, { dir: cache }).written).toBe(true);
    expect(syncCache(tc, { dir: cache }).written).toBe(false);
    const before = fingerprint(tc);
    mkdirSync(join(fx.inst, "VC", "Tools", "MSVC", "14.50.0000", "include"), { recursive: true });
    expect(fingerprint(tc)).not.toBe(before);
    expect(syncCache(tc, { dir: cache }).written).toBe(true);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("vswhere json maps to instances", () => {
  const rows = parseVswhere(
    JSON.stringify([
      {
        instanceId: "a",
        installationPath: "C:\\VS",
        installationVersion: "17.14.1",
        productId: "Microsoft.VisualStudio.Product.BuildTools",
        isPrerelease: false,
      },
    ]),
  );
  expect(rows[0]).toMatchObject({ id: "a", path: "C:\\VS", product: "Microsoft.VisualStudio.Product.BuildTools" });
});

test("setup uses the installer for an instance and winget for a fresh machine", () => {
  const env = { "ProgramFiles(x86)": "C:\\PF86" };
  const inst = { path: "C:\\VS", version: "17.14", displayName: "", product: "", prerelease: false };
  const modify = setupCommands({ instance: inst, arch: "arm64", toolset: "14.44.17.14", sdk: "10.0.22621.0" }, env)[0];
  expect(modify).toContain("modify");
  expect(modify).toContain("Microsoft.VisualStudio.Component.VC.14.44.17.14.ARM64");
  expect(modify).toContain("Microsoft.VisualStudio.Component.Windows11SDK.22621");
  expect(modify).toContain("--norestart");
  const fresh = setupCommands({}, env)[0];
  expect(fresh.slice(0, 3)).toEqual(["winget", "install", "--id"]);
  expect(fresh).toContain("Microsoft.VisualStudio.BuildTools");
  expect(fresh.at(-1)).toContain("Microsoft.VisualStudio.Workload.VCTools");
  expect(setupCommands({ instance: inst, repair: true }, env)[0]).toContain("repair");
  expect([0, 3010, 1641, 5].map(interpretInstallerExit)).toEqual(["ok", "reboot", "reboot", "failed"]);
});
