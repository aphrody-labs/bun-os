import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { llvmMingwRelease, locateMingw, mingwEnv, rustTarget } from "../src/providers/mingw.ts";
import {
  BUSYBOX,
  COREUTILS_APPLETS,
  fdRelease,
  planShims,
  ripgrepRelease,
  uutilsCoreutils,
  writeShim,
} from "../src/providers/posix.ts";
import { isMsys2Root, msys2Candidates, msys2InstallPlan, MSYS2_BASE } from "../src/providers/msys2.ts";
import { prefixPath, prefixPlan, protonRun, wineEnv, wineProvider } from "../src/providers/wine.ts";
import { runScript, shellQuote } from "../src/sh.ts";
import { getProfile } from "../src/profiles.ts";

const ctx = (platform: "win32" | "linux" | "darwin", env: Record<string, string> = {}) => ({
  platform,
  root: ".",
  env,
});

describe("posix provider", () => {
  test("asset names follow the published release names", () => {
    expect(uutilsCoreutils.asset("0.12.0", "win32", "x64")).toBe("coreutils-0.12.0-x86_64-pc-windows-msvc.zip");
    expect(uutilsCoreutils.asset("0.12.0", "linux", "arm64")).toBe(
      "coreutils-0.12.0-aarch64-unknown-linux-musl.tar.gz",
    );
    expect(ripgrepRelease.asset("15.2.0", "darwin", "arm64")).toBe("ripgrep-15.2.0-aarch64-apple-darwin.tar.gz");
    expect(fdRelease.asset("v10.5.0", "win32", "arm64")).toBe("fd-v10.5.0-aarch64-pc-windows-msvc.zip");
  });
  test("busybox pin is a sha256", () => {
    expect(BUSYBOX.files.x64!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  test("shim plan: uutils first, busybox fills sed/awk/grep on Windows only, no duplicates", () => {
    const have = {
      "uutils-coreutils": "C:/c/coreutils.exe",
      busybox: "C:/b/busybox.exe",
      ripgrep: "C:/r/rg.exe",
      "uutils-findutils": "C:/f/find.exe",
    };
    const win = planShims(have, "win32");
    const by = Object.fromEntries(win.map(s => [s.name, s.target]));
    expect(by.ls).toBe("C:/c/coreutils.exe");
    expect(by.sed).toBe("C:/b/busybox.exe");
    expect(by.find).toBe("C:/f/find.exe");
    expect(by.rg).toBe("C:/r/rg.exe");
    expect(new Set(win.map(s => s.name)).size).toBe(win.length);
    expect(planShims(have, "linux").some(s => s.name === "sed")).toBe(false);
    expect(COREUTILS_APPLETS.length).toBeGreaterThan(50);
  });
  test("writeShim links or copies the target under the applet name", () => {
    const dir = mkdtempSync(join(tmpdir(), "shim-"));
    const target = join(dir, "multi");
    writeFileSync(target, "x");
    writeShim(join(dir, "bin"), { name: "ls", target, kind: "multicall" });
    expect(readdirSync(join(dir, "bin")).some(f => f.startsWith("ls"))).toBe(true);
  });
});

describe("mingw provider", () => {
  test("llvm-mingw asset per host", () => {
    expect(llvmMingwRelease.asset("20261020", "win32", "x64")).toBe("llvm-mingw-20261020-ucrt-x86_64.zip");
    expect(llvmMingwRelease.asset("20261020", "win32", "arm64")).toBe("llvm-mingw-20261020-ucrt-aarch64.zip");
    expect(llvmMingwRelease.asset("20261020", "linux", "x64")).toBe(
      "llvm-mingw-20261020-ucrt-ubuntu-22.04-x86_64.tar.xz",
    );
    expect(llvmMingwRelease.asset("20261020", "darwin", "arm64")).toBe(
      "llvm-mingw-20261020-ucrt-macos-universal.tar.xz",
    );
  });
  test("rust targets and cargo env for both triples", () => {
    expect(rustTarget("x86_64-w64-mingw32", "llvm")).toBe("x86_64-pc-windows-gnullvm");
    expect(rustTarget("aarch64-w64-mingw32", "gcc")).toBe("aarch64-pc-windows-gnu");
    const env = mingwEnv("/opt/llvm-mingw/bin", "aarch64-w64-mingw32");
    expect(env.CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER).toContain("aarch64-w64-mingw32-clang");
    expect(env.CC_aarch64_pc_windows_gnullvm).toContain("aarch64-w64-mingw32-clang");
  });
  test("locateMingw finds a fake w64devkit", () => {
    process.env.BUNCC_CACHE_DIR = mkdtempSync(join(tmpdir(), "buncc-empty-"));
    const home = mkdtempSync(join(tmpdir(), "w64-"));
    mkdirSync(join(home, "bin"));
    const exe = process.platform === "win32" ? ".exe" : "";
    writeFileSync(join(home, "bin", `x86_64-w64-mingw32-gcc${exe}`), "");
    const found = locateMingw(ctx("linux", { W64DEVKIT_HOME: home, PATH: "" }));
    expect(found?.kind).toBe("w64devkit");
    expect(found?.flavor).toBe("gcc");
  });
  test("win32-mingw profile builds with the right triple", () => {
    const p = getProfile("win32-mingw");
    expect(p.steps({ target: "aarch64-w64-mingw32" })[0]!.command[0]).toBe("aarch64-w64-mingw32-clang");
    expect(p.steps({})[0]!.command[0]).toBe("x86_64-w64-mingw32-clang");
    expect(getProfile("win32-clang").steps({ target: "aarch64-pc-windows-msvc" })[0]!.command).toContain(
      "--target=aarch64-pc-windows-msvc",
    );
  });
});

describe("msys2 provider", () => {
  test("pin and plan", () => {
    expect(MSYS2_BASE.sha256).toMatch(/^[0-9a-f]{64}$/);
    const plan = msys2InstallPlan("C:/m/msys64", "clangarm64", ["gcc", "mingw-w64-clang-aarch64-cmake"]);
    expect(plan.at(-1)).toContain("mingw-w64-clang-aarch64-gcc");
    expect(plan.at(-1)).toContain("mingw-w64-clang-aarch64-cmake");
  });
  test("candidates and root detection use fakes, never the real disk", () => {
    expect(msys2Candidates({ MSYS2_ROOT: "D:\\m", USERPROFILE: "C:\\u" })[0]).toBe("D:\\m");
    expect(isMsys2Root("X", p => p.endsWith("msys-2.0.dll"))).toBe(true);
    expect(isMsys2Root("X", () => false)).toBe(false);
  });
});

describe("wine and proton", () => {
  test("not applicable on Windows", async () => {
    const d = await wineProvider.detect(ctx("win32"));
    expect(d.found).toBe(false);
    expect(d.notes?.[0]).toContain("not applicable");
  });
  test("prefix env and plan", () => {
    expect(wineEnv("game").WINEPREFIX).toBe(prefixPath("game"));
    expect(() => prefixPath("../x")).toThrow();
    const plan = prefixPlan("/w/bin/wine", "game", { dxvkDir: "/d" });
    expect(plan.commands.at(-1)![2]).toBe("install");
    expect(protonRun("/p", "g", "a.exe").env.STEAM_COMPAT_DATA_PATH).toContain("g");
  });
});

describe("buncc sh (Bun Shell)", () => {
  test("runs builtins, && and ||", async () => {
    const r = await runScript("echo hello && false || echo fallback", { quiet: true, posix: false });
    expect(r.stdout).toBe("hello\nfallback\n");
    expect(r.code).toBe(0);
    expect(shellQuote("a b")).toBe("'a b'");
  });
  test("propagates exit code and env", async () => {
    const r = await runScript("echo $FOO && exit 3", {
      quiet: true,
      posix: false,
      env: { FOO: "bar", PATH: Bun.env.PATH },
    });
    expect(r.stdout).toBe("bar\n");
    expect(r.code).toBe(3);
  });
});

// Real download of the portable binaries. Opt in with BUNCC_NET_TESTS=1 (GitHub; the default suite needs no network).
describe.skipIf(!Bun.env.BUNCC_NET_TESTS)("posix provisioning (network)", () => {
  test("uutils ls and cat run from the shim directory", async () => {
    const { ensurePosix } = await import("../src/providers/posix.ts");
    process.env.BUNCC_CACHE_DIR = mkdtempSync(join(tmpdir(), "buncc-net-"));
    const done = await ensurePosix({ only: ["uutils-coreutils"] });
    const ext = process.platform === "win32" ? ".exe" : "";
    expect(existsSync(join(done.dir, "ls" + ext))).toBe(true);
    const work = mkdtempSync(join(tmpdir(), "w-"));
    writeFileSync(join(work, "a.txt"), "hello posix\n");
    expect(Bun.spawnSync([join(done.dir, "ls" + ext), work]).stdout.toString()).toContain("a.txt");
    expect(Bun.spawnSync([join(done.dir, "cat" + ext), join(work, "a.txt")]).stdout.toString()).toBe("hello posix\n");
  }, 300_000);
});

describe("expandBraces", () => {
  test("rewrites ${NAME} for Bun Shell and leaves quoted or escaped forms", async () => {
    const { expandBraces } = await import("../src/sh.ts");
    expect(expandBraces('git config url."https://x:${TOKEN}@h/".insteadOf y').script).toBe(
      'git config url."https://x:""$TOKEN""@h/".insteadOf y',
    );
    expect(expandBraces("echo ${A}b '${A}' \\${A}").script).toBe("echo \"$A\"b '${A}' \\${A}");
    expect(expandBraces("echo ${A:-d}").unsupported).toEqual(["${A:-d}"]);
  });
  test("end to end", async () => {
    const r = await runScript('echo "<${X}>"', { quiet: true, posix: false, env: { X: "v", PATH: Bun.env.PATH } });
    expect(r.stdout).toBe("<v>\n");
  });
});
