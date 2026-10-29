import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { arToLib, chooseTool, compileCommands, gnuToLink, mergeCompileLog } from "../src/driver.ts";
import { tryAcquire } from "../src/lock.ts";
import { decideWrapper } from "../src/sccache.ts";
import { bundleArgs, canonicalTarget, compileArgs, parseTarget } from "../src/build/bun.ts";
import { fourPartVersion, innoScript, msixManifest, packagePlan, stableGuid } from "../src/packaging/index.ts";
import { glibcAtMost, maxGlibc, profiles } from "../src/profiles.ts";
import { vcvarsArch, vcvarsArguments, vcvarsCacheKey, vswhereArgs, parseVswhere } from "../src/providers/msvc.ts";
import { installPlanFor, WINGET_FLAGS } from "../src/providers/tools.ts";
import { compareVersions } from "../src/providers/types.ts";
import { parseToolchain } from "../src/providers/rust.ts";

const dir = mkdtempSync(join(tmpdir(), "buncc-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const only =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name);

test("Windows prefers cl, then clang-cl, then GNU compilers for gnu targets", () => {
  const base = { kind: "cc" as const, platform: "win32" as const };
  expect(chooseTool({ ...base, has: only("cl", "clang-cl", "clang") })).toEqual({
    name: "cl",
    dialect: "msvc",
    needsVcvars: true,
  });
  expect(chooseTool({ ...base, has: only("clang-cl", "clang") })?.name).toBe("clang-cl");
  expect(chooseTool({ ...base, has: only("clang", "gcc") })).toEqual({
    name: "clang",
    dialect: "gnu",
    needsVcvars: false,
  });
  expect(chooseTool({ ...base, target: "x86_64-pc-windows-gnu", has: only("cl", "gcc", "clang") })?.name).toBe("clang");
  expect(chooseTool({ ...base, has: only() })).toBeNull();
});

test("preference overrides the order, c++ maps to the matching binary", () => {
  expect(chooseTool({ kind: "cc", platform: "win32", preference: "clang", has: only("cl", "clang") })?.name).toBe(
    "clang",
  );
  expect(chooseTool({ kind: "c++", platform: "linux", preference: "gcc", has: only("g++", "clang++") })?.name).toBe(
    "g++",
  );
  expect(chooseTool({ kind: "c++", platform: "linux", has: only("g++", "clang++") })?.name).toBe("clang++");
  expect(chooseTool({ kind: "cc", platform: "win32", preference: "gcc", has: only("cl") })?.name).toBe("cl");
});

test("archiver and linker choices per platform", () => {
  expect(chooseTool({ kind: "ar", platform: "win32", has: only("lib", "llvm-ar") })?.name).toBe("lib");
  expect(chooseTool({ kind: "ar", platform: "linux", has: only("ar", "llvm-ar") })?.name).toBe("ar");
  expect(chooseTool({ kind: "link", platform: "win32", has: only("link", "lld-link") })?.needsVcvars).toBe(true);
  expect(chooseTool({ kind: "link", platform: "linux", has: only("gcc") })?.name).toBe("gcc");
});

test("ar and link command lines translate to lib.exe and link.exe", () => {
  expect(arToLib(["rcs", "libx.a", "a.o", "b.o"])).toEqual(["/nologo", "/OUT:libx.a", "a.o", "b.o"]);
  expect(gnuToLink(["a.obj", "-o", "a.exe", "-Lc:/l", "-lws2_32", "-shared"])).toEqual([
    "/nologo",
    "a.obj",
    "/OUT:a.exe",
    "/LIBPATH:c:/l",
    "ws2_32.lib",
    "/DLL",
  ]);
});

test("compile_commands entries only exist for -c invocations and dedupe by file", () => {
  expect(compileCommands("/w", "cc", ["-O2", "a.c"])).toEqual([]);
  const entries = compileCommands("/w", "cc", ["-c", "a.c", "-o", "a.o"]);
  expect(entries).toEqual([{ directory: "/w", arguments: ["cc", "-c", "a.c", "-o", "a.o"], file: "a.c" }]);
  const log = [entries[0], { ...entries[0]!, arguments: ["cc", "-c", "-O3", "a.c"] }]
    .map(entry => JSON.stringify(entry))
    .join("\n");
  const merged = mergeCompileLog(log + "\nnot json\n");
  expect(merged).toHaveLength(1);
  expect(merged[0]!.arguments).toContain("-O3");
});

test("sccache is bypassed when unhealthy or off", () => {
  expect(decideWrapper({ path: "/s", healthy: true, reason: "ok" }).wrapper).toBe("/s");
  expect(decideWrapper({ path: "/s", healthy: false, reason: "exit 101: panic" })).toEqual({
    wrapper: null,
    note: "sccache bypassed: exit 101: panic",
  });
  expect(decideWrapper({ path: null, healthy: false, reason: "" }).wrapper).toBeNull();
  expect(decideWrapper({ path: "/s", healthy: true, reason: "ok" }, "off").wrapper).toBeNull();
});

test("a lock file excludes a live holder and is broken when the holder is gone or stale", () => {
  const path = join(dir, "a.lock");
  const release = tryAcquire(path)!;
  expect(release).toBeFunction();
  expect(tryAcquire(path)).toBeNull();
  release();
  const again = tryAcquire(path)!;
  expect(again).toBeFunction();
  expect(tryAcquire(path, 1000, Date.now() + 10_000)).toBeFunction();
  Bun.write(join(dir, "dead.lock"), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: Date.now() }));
  expect(tryAcquire(join(dir, "dead.lock"))).toBeFunction();
});

test("compile target parsing follows the upstream table", () => {
  expect(parseTarget("bun-linux-x64-musl")).toMatchObject({ os: "linux", arch: "x64", musl: true });
  expect(canonicalTarget(parseTarget("bun-windows-x64-modern"))).toBe("bun-windows-x64");
  expect(canonicalTarget(parseTarget("bun-x64-linux-baseline-musl"))).toBe("bun-linux-x64-musl");
  expect(() => parseTarget("bun-darwin-arm64-musl")).toThrow();
  expect(() => parseTarget("linux-x64")).toThrow();
  expect(() => parseTarget("bun-linux")).toThrow();
});

test("bun build and compile arguments", () => {
  expect(bundleArgs({ entry: ["a.ts"], outdir: "dist", target: "bun", minify: true, splitting: true })).toEqual([
    "build",
    "a.ts",
    "--outdir",
    "dist",
    "--target=bun",
    "--minify",
    "--splitting",
  ]);
  expect(
    compileArgs(
      { entry: "a.ts", outfile: "app", aot: true, minify: true, target: "bun-linux-x64-baseline" },
      "linux",
      "x64",
    ),
  ).toEqual(["build", "--compile", "--aot", "--target=bun-linux-x64", "--minify", "a.ts", "--outfile", "app"]);
  expect(() => compileArgs({ entry: "a.ts", outfile: "x", aotAllowCodeFromDisk: true })).toThrow(/requires --aot/);
});

test("Windows metadata flags are refused when cross-compiling, hide-console is allowed", () => {
  expect(() =>
    compileArgs({ entry: "a.ts", outfile: "x", target: "bun-windows-x64", windows: { icon: "a.ico" } }, "linux"),
  ).toThrow(/Windows host/);
  expect(
    compileArgs({ entry: "a.ts", outfile: "x", target: "bun-windows-x64", windows: { hideConsole: true } }, "linux"),
  ).toContain("--windows-hide-console");
  expect(compileArgs({ entry: "a.ts", outfile: "x", windows: { icon: "a.ico", title: "T" } }, "win32")).toEqual([
    "build",
    "--compile",
    "--windows-icon=a.ico",
    "--windows-title=T",
    "a.ts",
    "--outfile",
    "x",
  ]);
  expect(() =>
    compileArgs({ entry: "a.ts", outfile: "x", target: "bun-linux-x64", windows: { hideConsole: true } }, "win32"),
  ).toThrow();
});

test("vswhere and vcvars helpers", () => {
  expect(vswhereArgs()).toEqual([
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-format",
    "json",
    "-utf8",
  ]);
  expect(vswhereArgs(true).at(-1)).toBe("-prerelease");
  expect(parseVswhere('[{"installationPath":"C:\\\\VS","installationVersion":"18.1"}]')[0]?.installationPath).toBe(
    "C:\\VS",
  );
  expect(parseVswhere("garbage")).toEqual([]);
  expect(vcvarsArch("x64")).toBe("x64");
  expect(vcvarsArch("arm64")).toBe("x64_arm64");
  expect(vcvarsArguments({ arch: "x64", sdk: "10.0.26100.0", toolset: "14.44" })).toEqual([
    "x64",
    "10.0.26100.0",
    "-vcvars_ver=14.44",
  ]);
  const key = vcvarsCacheKey("C:\\vc\\vcvarsall.bat", 1, { arch: "x64" });
  expect(key).toBe(vcvarsCacheKey("c:\\VC\\vcvarsall.bat", 1.5, { arch: "x64" }));
  expect(key).not.toBe(vcvarsCacheKey("C:\\vc\\vcvarsall.bat", 2, { arch: "x64" }));
});

test("install plans are unattended", () => {
  const spec = { id: "cmake", description: "", bins: ["cmake"], winget: "Kitware.CMake", apt: "cmake" };
  const win = installPlanFor(spec, "win32").commands[0]!;
  expect(win.slice(0, 4)).toEqual(["winget", "install", "--id", "Kitware.CMake"]);
  for (const flag of WINGET_FLAGS) expect(win).toContain(flag);
  expect(installPlanFor(spec, "linux").commands[0]).toContain("-y");
  expect(installPlanFor({ ...spec, winget: undefined }, "win32").manual).toBeString();
  expect(compareVersions("4.4.10", "4.4.9")).toBeGreaterThan(0);
  expect(compareVersions("1.2", "1.2.0")).toBe(0);
});

test("rust-toolchain.toml is parsed with Bun.TOML", () => {
  expect(parseToolchain('[toolchain]\nchannel = "nightly-2026-09-15"\ncomponents = ["clippy"]\n')).toEqual({
    channel: "nightly-2026-09-15",
    components: ["clippy"],
  });
});

test("packaging: manifest, plan and guid", () => {
  expect(fourPartVersion("1.4.7")).toBe("1.4.7.0");
  expect(fourPartVersion("2.0.0-canary.1")).toBe("2.0.0.0");
  const app = {
    name: "Aphrody.BunOS",
    publisher: "CN=Aphrody",
    displayName: "Bun <OS>",
    publisherDisplayName: "Aphrody",
    version: "1.4.7",
    executable: "bun-os.exe",
  };
  const manifest = msixManifest(app);
  expect(manifest).toContain('uap10:RuntimeBehavior="packagedClassicApp"');
  expect(manifest).toContain('<rescap:Capability Name="runFullTrust" />');
  expect(manifest).toContain("Bun &lt;OS&gt;");
  expect(() => msixManifest({ ...app, name: "x" })).toThrow();
  expect(packagePlan("msix", app, "d", "o").steps[1]!.command).toEqual([
    "makeappx",
    "pack",
    "/d",
    "d",
    "/p",
    "o/Aphrody.BunOS-1.4.7.0.msix",
    "/o",
  ]);
  const msi = packagePlan("msi", app, "d", "o");
  expect(msi.steps[0]).toMatchObject({ command: ["wix", "eula", "accept", "wix7"], needsApproval: true });
  expect(stableGuid("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(stableGuid("a")).toBe(stableGuid("a"));
  expect(
    innoScript({
      appName: "A",
      version: "1",
      publisher: "P",
      sourceDir: "s",
      executable: "a.exe",
      outputDir: "o",
      outputBaseName: "b",
      appId: stableGuid("a"),
    }),
  ).toContain("AppId={{");
});

test("glibc floor checking reads GLIBC_2.x tags", () => {
  const text = "0 FUNC GLIBC_2.2.5 memcpy\n 1 FUNC GLIBC_2.34 __libc_start_main\n GLIBC_2.17 x";
  expect(maxGlibc(text)).toBe("2.34");
  expect(glibcAtMost(text, "2.28")).toBe(false);
  expect(glibcAtMost(text, "2.34")).toBe(true);
  expect(maxGlibc("nothing")).toBeNull();
});

test("every profile renders its steps without running anything", () => {
  for (const profile of Object.values(profiles)) {
    const steps = profile.steps({ entry: "a.ts", outfile: "out", source: "m.c" });
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step.command.length).toBeGreaterThan(0);
  }
  expect(profiles["aot-bun"].steps({ entry: "a.ts", outfile: "o" })[0]!.command).toContain("--aot");
  expect(profiles["aot-dotnet11"].steps({})[0]!.command).toContain("net11.0");
  expect(
    profiles["glibc-gnu"].steps({ target: "x86_64-linux-gnu.2.28", source: "m.c" })[0]!.command.slice(0, 3),
  ).toEqual(["zig", "cc", "-target"]);
});

test("audit fixes: store plan, manifest version, MinVersion, vcpkg clone, winget reboot codes", async () => {
  const { storePlan } = await import("../src/packaging/index.ts");
  const { manifestProblems } = await import("../src/providers/msix.ts");
  const { cloneCommands } = await import("../src/providers/vcpkg.ts");
  const { interpretExit } = await import("../src/providers/winget.ts");
  const plan = storePlan("out/app.msix", "9NBLGGH4NNS1");
  expect(plan[0]).toMatchObject({ command: ["appcert", "reset"], optional: true });
  expect(plan[1]).toMatchObject({ optional: true });
  const publish = plan.find(step => step.command?.[1] === "publish")!;
  expect(publish.command).toEqual(["msstore", "publish", "-i", "out/app.msix", "--appId", "9NBLGGH4NNS1"]);
  expect(publish.needsApproval).toBe(true);
  expect(plan.find(step => step.command?.[1] === "reconfigure")?.needsApproval).toBe(true);
  const identity = { name: "Aphrody.BunOS", publisher: "CN=Aphrody", executable: "a.exe" };
  expect(manifestProblems({ ...identity, version: "1.4.7.0" })).toEqual([]);
  expect(manifestProblems({ ...identity, version: "1.4.7" })).toHaveLength(1);
  expect(manifestProblems({ ...identity, version: "1.4.7.70000" })).toHaveLength(1);
  expect(
    msixManifest({
      name: "Aphrody.BunOS",
      publisher: "CN=A",
      displayName: "A",
      publisherDisplayName: "A",
      version: "1.0.0",
      executable: "a.exe",
    }),
  ).toContain('MinVersion="10.0.19041.0"');
  expect(cloneCommands("C:\v")[0]).not.toContain("--depth");
  for (const code of [0x8a150109, 0x8a15010a, 0x8a15010b, 3010, 1641]) expect(interpretExit(code | 0)).toBe("reboot");
  expect(interpretExit(0x8a150010 | 0)).toBe("no-applicable-installer");
});

test("--aot refuses a foreign --target before calling Bun, plain cross-compiles still work", () => {
  expect(() =>
    compileArgs({ entry: "a.ts", outfile: "x", aot: true, target: "bun-linux-x64" }, "win32", "x64"),
  ).toThrow(/can't cross-compile/);
  expect(() =>
    compileArgs({ entry: "a.ts", outfile: "x", aot: true, target: "bun-linux-arm64" }, "linux", "x64"),
  ).toThrow(/can't cross-compile/);
  expect(compileArgs({ entry: "a.ts", outfile: "x", aot: true, target: "bun-windows-x64" }, "win32", "x64")).toContain(
    "--aot",
  );
  expect(compileArgs({ entry: "a.ts", outfile: "x", target: "bun-linux-x64" }, "win32", "x64")).not.toContain("--aot");
});

test("xwin: no macOS asset, 32-bit ARM is spelled aarch, triples follow", async () => {
  const { xwinRelease, splatArgs, crossEnv } = await import("../src/providers/xwin.ts");
  expect(xwinRelease.asset("0.10.0", "darwin", "arm64")).toBeUndefined();
  expect(xwinRelease.asset("0.10.0", "darwin", "x64")).toBeUndefined();
  expect(xwinRelease.asset("0.10.0", "linux", "arm64")).toBe("xwin-0.10.0-aarch64-unknown-linux-musl.tar.gz");
  expect(splatArgs({ acceptLicense: true, arch: ["x86_64", "aarch"] }).join(" ")).toContain("--arch x86_64,aarch");
  expect(Object.keys(crossEnv("/s", ["aarch"])).some(key => key.includes("THUMBV7A_PC_WINDOWS_MSVC"))).toBe(true);
});
