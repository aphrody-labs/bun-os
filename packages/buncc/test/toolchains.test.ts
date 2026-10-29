import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findInstalled, installGithubTool, pickAsset, type GithubToolSpec } from "../src/providers/_github.ts";
import {
  ChecksumError,
  detectPackageManager,
  download,
  installPlanFor,
  packageInstallCommand,
  pinFromToolchain,
} from "../src/providers/_shared.ts";
import { cmakeRelease } from "../src/providers/cmake.ts";
import { llvmBinCandidates } from "../src/providers/clang.ts";
import { justRelease } from "../src/providers/just.ts";
import { ninjaRelease } from "../src/providers/make.ts";
import { uvRelease } from "../src/providers/uv.ts";
import { xwinRelease } from "../src/providers/xwin.ts";
import { binaryenRelease } from "../src/providers/wasm.ts";
import {
  binaryCacheDir,
  findRoot,
  installArgs as vcpkgInstall,
  manifestBaseline,
  triplet,
  vcpkgEnv,
} from "../src/providers/vcpkg.ts";
import {
  buildLock,
  installArgs as wingetInstall,
  installedFromTable,
  interpretExit,
  parseTable,
  planDependencies,
  readSystemDependencies,
  satisfies,
  verifyLock,
} from "../src/providers/winget.ts";
import { msixManifest } from "../src/packaging/index.ts";
import { manifestProblems, packArgs, readIdentity, redact, signArgs, wixBuildArgs } from "../src/providers/msix.ts";
import { toolchainProviders } from "../src/providers/toolchains.ts";

let cache: string;
beforeAll(() => {
  cache = mkdtempSync(join(tmpdir(), "buncc-cache-"));
  Bun.env.BUNCC_CACHE_DIR = cache;
});
afterAll(() => {
  delete Bun.env.BUNCC_CACHE_DIR;
  rmSync(cache, { recursive: true, force: true });
});

test("every provider has an id, a platform list and a Windows/Unix-safe install plan", () => {
  const ids = toolchainProviders.map(p => p.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(
    expect.arrayContaining([
      "msvc-layout",
      "winget",
      "dotnet",
      "dotnet:10.0",
      "dotnet:11.0",
      "vcpkg",
      "cmake",
      "clang",
      "make",
      "ninja",
      "xwin",
      "gn",
      "msix",
      "makepkg",
      "uv",
      "just",
    ]),
  );
  for (const p of toolchainProviders) {
    expect(p.platforms.length).toBeGreaterThan(0);
    for (const platform of p.platforms) {
      const plan = p.install({ platform, root: process.cwd(), env: {} });
      for (const cmd of plan.commands) expect(cmd.every(a => typeof a === "string" && a.length > 0)).toBe(true);
    }
  }
}, 120_000);

test("release asset names", () => {
  expect(cmakeRelease.asset("v4.4.5", "win32", "x64")).toBe("cmake-4.4.5-windows-x86_64.zip");
  expect(cmakeRelease.asset("v4.4.5", "win32", "arm64")).toBe("cmake-4.4.5-windows-arm64.zip");
  expect(cmakeRelease.asset("v4.4.5", "linux", "arm64")).toBe("cmake-4.4.5-linux-aarch64.tar.gz");
  expect(cmakeRelease.asset("v4.4.5", "darwin", "arm64")).toBe("cmake-4.4.5-macos-universal.tar.gz");
  expect(ninjaRelease.asset("v1.13.2", "win32", "arm64")).toBe("ninja-winarm64.zip");
  expect(ninjaRelease.asset("v1.13.2", "linux", "x64")).toBe("ninja-linux.zip");
  expect(justRelease.asset("1.59.0", "win32", "x64")).toBe("just-1.59.0-x86_64-pc-windows-msvc.zip");
  expect(justRelease.asset("1.59.0", "linux", "arm64")).toBe("just-1.59.0-aarch64-unknown-linux-musl.tar.gz");
  expect(uvRelease.asset("0.13.6", "linux", "x64")).toBe("uv-x86_64-unknown-linux-gnu.tar.gz");
  expect(uvRelease.asset("0.13.6", "win32", "arm64")).toBe("uv-aarch64-pc-windows-msvc.zip");
  expect(xwinRelease.asset("0.10.0", "linux", "x64")).toBe("xwin-0.10.0-x86_64-unknown-linux-musl.tar.gz");
  expect(xwinRelease.asset("0.10.0", "win32", "arm64")).toBeUndefined();
  expect(binaryenRelease.asset("version_133", "win32", "x64")).toBe("binaryen-version_133-x86_64-windows.tar.gz");
  expect(binaryenRelease.asset("version_133", "darwin", "arm64")).toBe("binaryen-version_133-arm64-macos.tar.gz");
});

test("asset digest is required and parsed", () => {
  const release = {
    tag_name: "v1",
    assets: [
      { name: "a.zip", browser_download_url: "https://x/a.zip", digest: "sha256:abc" },
      { name: "b.zip", browser_download_url: "https://x/b.zip", digest: null },
    ],
  };
  expect(pickAsset(release, "a.zip")).toEqual({ tag: "v1", name: "a.zip", url: "https://x/a.zip", sha256: "abc" });
  expect(() => pickAsset(release, "b.zip")).toThrow("no published sha256");
  expect(() => pickAsset(release, /c\.zip/)).toThrow("no asset matching");
});

test("verified download, extract and discovery of a release", async () => {
  const archive = await new Bun.Archive(
    { "fake-1.2.3/bin/faketool": "#!/bin/sh\n", "fake-1.2.3/bin/faketool.exe": "MZ" },
    { compress: "gzip" },
  ).bytes();
  const sha = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  const spec: GithubToolSpec = {
    id: "faketool",
    repo: "o/faketool",
    binary: "faketool",
    asset: tag => `fake-${tag}.tar.gz`,
  };
  const release = (digest: string) => ({
    tag_name: "1.2.3",
    assets: [{ name: "fake-1.2.3.tar.gz", browser_download_url: "https://dl/fake.tar.gz", digest: `sha256:${digest}` }],
  });
  const fetcherFor = (digest: string): typeof fetch =>
    (async (url: string) =>
      String(url).includes("api.github.com")
        ? Response.json(release(digest))
        : new Response(archive)) as unknown as typeof fetch;

  const bad = installGithubTool(spec, { platform: "linux", arch: "x64", fetcher: fetcherFor("0".repeat(64)) });
  await expect(bad).rejects.toBeInstanceOf(ChecksumError);
  expect(findInstalled(spec)).toBeUndefined();

  const dry = await installGithubTool(spec, { platform: "linux", arch: "x64", fetcher: fetcherFor(sha), dryRun: true });
  expect(dry.status).toBe("dry-run");
  const done = await installGithubTool(spec, { platform: "linux", arch: "x64", fetcher: fetcherFor(sha) });
  expect(done.status).toBe("installed");
  expect(done.bin?.replaceAll("\\", "/")).toContain("faketool/1.2.3/");
  expect(findInstalled(spec)?.version).toBe("1.2.3");
  expect((await installGithubTool(spec, { platform: "linux", arch: "x64", fetcher: fetcherFor(sha) })).status).toBe(
    "already-installed",
  );
});

test("download refuses a wrong checksum before returning bytes", async () => {
  const f = (async () => new Response("payload")) as unknown as typeof fetch;
  await expect(download("https://x/y", "00", "sha256", f)).rejects.toThrow("checksum");
  const ok = new Bun.CryptoHasher("sha256").update("payload").digest("hex");
  expect(new TextDecoder().decode(await download("https://x/y", ok.toUpperCase(), "sha256", f))).toBe("payload");
});

test("package manager commands", () => {
  expect(detectPackageManager("win32")).toBe("winget");
  expect(detectPackageManager("linux", c => c === "pacman" || c === "apt-get")).toBe("pacman");
  expect(detectPackageManager("linux", c => c === "apk")).toBe("apk");
  expect(detectPackageManager("darwin", () => false)).toBeUndefined();
  expect(packageInstallCommand("pacman", ["clang", "lld"], false)).toEqual([
    "sudo",
    "pacman",
    "-S",
    "--needed",
    "--noconfirm",
    "clang",
    "lld",
  ]);
  expect(packageInstallCommand("apt", "cmake", true)).toEqual(["apt-get", "install", "-y", "cmake"]);
  expect(installPlanFor({ winget: ["A.B", "C.D"] }, "win32").map(c => c[3])).toEqual(["A.B", "C.D"]);
  expect(installPlanFor({ pacman: "x" }, "win32")).toEqual([]);
});

test("pin read from buncc.toolchain.json", async () => {
  const root = mkdtempSync(join(tmpdir(), "buncc-pin-"));
  try {
    writeFileSync(
      join(root, "buncc.toolchain.json"),
      JSON.stringify({ tools: { cmake: "4.4.4", clang: { version: "23.1.4" } } }),
    );
    const ctx = { platform: "linux" as const, root, env: {} };
    expect(await pinFromToolchain(ctx, "cmake")).toBe("4.4.4");
    expect(await pinFromToolchain(ctx, "clang")).toBe("23.1.4");
    expect(await pinFromToolchain(ctx, "ninja")).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clang search order prefers the newest versioned LLVM directory", () => {
  const list = (dir: string) => (dir === "/usr/lib" ? ["llvm-17", "llvm-21", "llvm20", "python3"] : []);
  const c = llvmBinCandidates("linux", { LLVM_PATH: "/opt/llvm" }, list).map(p => p.replaceAll("\\", "/"));
  expect(c.slice(0, 2)).toEqual(["/opt/llvm/bin", "/opt/llvm"]);
  expect(c.indexOf("/usr/lib/llvm-21/bin")).toBeLessThan(c.indexOf("/usr/lib/llvm-17/bin"));
  expect(c).toContain("/usr/lib/llvm20/bin");
  expect(llvmBinCandidates("win32", { ProgramFiles: "C:\\PF" }, () => []).map(p => p.replaceAll("\\", "/"))).toContain(
    "C:/PF/LLVM/bin",
  );
});

test("vcpkg triplets, environment and install arguments", () => {
  expect(triplet("win32", "x64")).toBe("x64-windows");
  expect(triplet("win32", "arm64", "static")).toBe("arm64-windows-static");
  expect(triplet("linux", "x64", "static")).toBe("x64-linux");
  expect(triplet("linux", "arm64", "dynamic")).toBe("arm64-linux-dynamic");
  expect(triplet("darwin", "arm64")).toBe("arm64-osx-dynamic");
  expect(() => triplet("linux", "x86")).toThrow("no x86-linux");
  const env = vcpkgEnv("/v", "win32", "arm64");
  expect(env.VCPKG_DEFAULT_TRIPLET).toBe("arm64-windows");
  expect(env.CMAKE_TOOLCHAIN_FILE.replaceAll("\\", "/")).toBe("/v/scripts/buildsystems/vcpkg.cmake");
  expect(binaryCacheDir({}).replaceAll("\\", "/")).toMatch(/\/vcpkg\/archives$/);
  expect(vcpkgEnv("/v", "linux", "x64", { cache: "/c" }).VCPKG_DEFAULT_BINARY_CACHE).toBe("/c");
  expect(env.VCPKG_DISABLE_METRICS).toBe("1");
  expect(vcpkgInstall({ manifestRoot: ".", triplet: "x64-windows" })).toEqual([
    "install",
    "--x-manifest-root",
    ".",
    "--triplet",
    "x64-windows",
    "--no-print-usage",
  ]);
  const root = mkdtempSync(join(tmpdir(), "buncc-vcpkg-"));
  try {
    mkdirSync(join(root, "vendor", "vcpkg"), { recursive: true });
    writeFileSync(join(root, "vendor", "vcpkg", ".vcpkg-root"), "");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(findRoot(join(root, "a", "b"), {})).toBe(join(root, "vendor", "vcpkg"));
    writeFileSync(join(root, "vcpkg.json"), JSON.stringify({ name: "x", "builtin-baseline": "abc123" }));
    expect(manifestBaseline(root)).toBe("abc123");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const FRENCH_LIST =
  "\\\r\nNom                        ID                           Version       Disponible  Source\r\n---------------------------------------------------------------------------------------\r\nCMake                      Kitware.CMake                4.4.4                     winget\r\nMicrosoft .NET SDK 10.0    Microsoft.DotNet.SDK.10      10.0.401      10.0.403    winget\r\njq                         jqlang.jq                    < 1.7.1                   winget\r\n";

test("winget table parsing, ranges, plan and lock", () => {
  const rows = parseTable(FRENCH_LIST);
  expect(rows).toHaveLength(3);
  expect(rows[1]).toMatchObject({
    Nom: "Microsoft .NET SDK 10.0",
    ID: "Microsoft.DotNet.SDK.10",
    Version: "10.0.401",
    Disponible: "10.0.403",
  });
  const installed = installedFromTable(FRENCH_LIST);
  expect(installed.map(i => `${i.id}@${i.version}`)).toEqual([
    "Kitware.CMake@4.4.4",
    "Microsoft.DotNet.SDK.10@10.0.401",
    "jqlang.jq@1.7.1",
  ]);
  expect(parseTable("no table here")).toEqual([]);

  expect(satisfies("1.7.1", "*")).toBe(true);
  expect(satisfies("1.7.1", "1.7.x")).toBe(true);
  expect(satisfies("1.8.0", "1.7.x")).toBe(false);
  expect(satisfies("10.0.401", ">=10.0.100 <11")).toBe(true);
  expect(satisfies("0.9", "^1.0 || 0.9")).toBe(true);
  expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
  expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
  expect(satisfies("1.10.0", ">1.9.0")).toBe(true);

  const deps = readSystemDependencies({
    systemDependencies: {
      "winget:jqlang.jq": "*",
      "winget:Kitware.CMake": "4.4.5",
      "winget:Gyan.FFmpeg": ">=7",
      "npm:x": "1",
    },
  });
  expect(deps.map(d => d.id)).toEqual(["jqlang.jq", "Kitware.CMake", "Gyan.FFmpeg"]);
  const plan = planDependencies(deps, installed);
  expect(plan.map(p => p.action)).toEqual(["skip", "upgrade", "install"]);
  expect(plan[1]!.command).toContain("upgrade");
  expect(plan[1]!.command).toContain("4.4.5");
  expect(plan[2]!.command).toContain("install");
  expect(plan[2]!.version).toBeUndefined();

  const lock = buildLock(deps, installed);
  expect(Object.keys(lock.packages)).toEqual(["Kitware.CMake", "jqlang.jq"]);
  expect(verifyLock(deps, lock)).toEqual([
    "Kitware.CMake 4.4.4 (locked) does not satisfy 4.4.5",
    "Gyan.FFmpeg is not in buncc.winget.lock.json",
  ]);
  expect(verifyLock([], lock)).toHaveLength(2);

  expect(interpretExit(0)).toBe("installed");
  expect(interpretExit(-1978335135)).toBe("already-installed");
  expect(interpretExit(-1978335189)).toBe("already-installed");
  expect(interpretExit(3010)).toBe("reboot");
  expect(interpretExit(1)).toBe("failed");
  expect(wingetInstall({ id: "a.b", version: "1", scope: "user" })).toEqual([
    "install",
    "--id",
    "a.b",
    "--exact",
    "--source",
    "winget",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity",
    "--version",
    "1",
    "--scope",
    "user",
  ]);
});

test("msix packaging commands, manifest and signing", () => {
  expect(packArgs({ dir: "d", out: "o.msix" })).toEqual(["pack", "/d", "d", "/p", "o.msix", "/o"]);
  const opts = {
    name: "Aphrody.BunOS",
    publisher: "CN=Aphrody",
    version: "1.4.7.0",
    displayName: "Bun OS",
    publisherDisplayName: "Aphrody",
    executable: "bun.exe",
  };
  const xml = msixManifest(opts);
  expect(readIdentity(xml)).toEqual({
    name: "Aphrody.BunOS",
    publisher: "CN=Aphrody",
    version: "1.4.7.0",
    arch: "x64",
  });
  expect(xml).toContain('<rescap:Capability Name="runFullTrust" />');
  expect(manifestProblems({ ...opts, version: "1.4.7", publisher: "Aphrody", name: "a" })).toHaveLength(3);

  const thumb = "a".repeat(40);
  expect(signArgs({ file: "o.msix", cert: { kind: "store-thumbprint", sha1: thumb } })).toEqual([
    "sign",
    "/fd",
    "SHA256",
    "/sha1",
    thumb,
    "/tr",
    "http://timestamp.digicert.com",
    "/td",
    "SHA256",
    "o.msix",
  ]);
  expect(() => signArgs({ file: "x", cert: { kind: "store-thumbprint", sha1: "zz" } })).toThrow("40 hex");
  expect(() => signArgs({ file: "x", cert: { kind: "pfx", file: "c.pfx", passwordEnv: "NOPE_PW" } }, {})).toThrow(
    "NOPE_PW",
  );
  const withPw = signArgs(
    { file: "x", cert: { kind: "pfx", file: "c.pfx", passwordEnv: "PW" }, timestamp: false },
    { PW: "secret" },
  );
  expect(withPw).toContain("secret");
  expect(redact(withPw)).not.toContain("secret");
  expect(wixBuildArgs({ sources: ["a.wxs"], out: "a.msi", arch: "x64", defines: { Version: "1.0" } })).toEqual([
    "build",
    "-o",
    "a.msi",
    "-arch",
    "x64",
    "-d",
    "Version=1.0",
    "a.wxs",
  ]);
});
