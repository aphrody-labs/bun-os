/**
 * mingw: a GNU-ABI Windows toolchain (x86_64-w64-mingw32, aarch64-w64-mingw32) without MSYS2.
 *
 * Managed default: mstorsjo/llvm-mingw (clang + lld + mingw-w64 headers/crt, UCRT, hosts Windows/Linux/macOS, produces
 * x86_64, aarch64, i686, armv7). Detected as alternatives: winlibs (GCC), w64devkit (skeeto, self-extracting 7z, not
 * auto-installed), any `*-w64-mingw32-*` on PATH, and, read-only, an existing MSYS2 ucrt64/clang64 tree.
 */
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { findInstalled, installGithubTool, type GithubToolSpec } from "./_github.ts";
import { missing, pathVar, prependPath, probeVersion, which } from "./_shared.ts";
import type { Context, Detection, Provider } from "./types.ts";

export type MingwTriple = "x86_64-w64-mingw32" | "aarch64-w64-mingw32" | "i686-w64-mingw32" | "armv7-w64-mingw32";
export const MINGW_TRIPLES: MingwTriple[] = ["x86_64-w64-mingw32", "aarch64-w64-mingw32"];

/** Rust target for a mingw triple: gnullvm with llvm-mingw (clang), gnu with a GCC mingw. */
export function rustTarget(triple: MingwTriple, flavor: "llvm" | "gcc"): string {
  const cpu = triple.split("-")[0]!;
  return `${cpu === "armv7" ? "thumbv7a" : cpu}-pc-windows-${flavor === "llvm" ? "gnullvm" : "gnu"}`;
}

export const llvmMingwRelease: GithubToolSpec = {
  id: "llvm-mingw",
  repo: "mstorsjo/llvm-mingw",
  binary: "x86_64-w64-mingw32-clang",
  asset(tag, platform, arch) {
    if (platform === "win32")
      return arch === "arm64"
        ? `llvm-mingw-${tag}-ucrt-aarch64.zip`
        : arch === "x86"
          ? `llvm-mingw-${tag}-ucrt-i686.zip`
          : `llvm-mingw-${tag}-ucrt-x86_64.zip`;
    if (platform === "darwin") return `llvm-mingw-${tag}-ucrt-macos-universal.tar.xz`;
    return arch === "arm64"
      ? `llvm-mingw-${tag}-ucrt-ubuntu-22.04-aarch64.tar.xz`
      : arch === "x64"
        ? `llvm-mingw-${tag}-ucrt-ubuntu-22.04-x86_64.tar.xz`
        : undefined;
  },
};

/** Environment that makes cc-rs, cargo, cmake and autotools use the mingw toolchain for `triple`. Pure. */
export function mingwEnv(binDir: string, triple: MingwTriple, flavor: "llvm" | "gcc" = "llvm"): Record<string, string> {
  const rust = rustTarget(triple, flavor);
  const key = rust.replaceAll("-", "_");
  const upper = key.toUpperCase();
  const tool = (name: string) => join(binDir, `${triple}-${name}`);
  const cc = flavor === "llvm" ? tool("clang") : tool("gcc");
  const cxx = flavor === "llvm" ? tool("clang++") : tool("g++");
  return {
    [`CC_${key}`]: cc,
    [`CXX_${key}`]: cxx,
    [`AR_${key}`]: flavor === "llvm" ? tool("ar") : tool("gcc-ar"),
    [`CARGO_TARGET_${upper}_LINKER`]: cc,
    [`CARGO_TARGET_${upper}_AR`]: flavor === "llvm" ? tool("ar") : tool("gcc-ar"),
    BUNCC_MINGW_TRIPLE: triple,
    BUNCC_MINGW_RUST_TARGET: rust,
  };
}

export interface MingwFound {
  flavor: "llvm" | "gcc";
  kind: "managed" | "path" | "w64devkit" | "winlibs" | "msys2-readonly";
  binDir: string;
  triples: MingwTriple[];
}

const hasTriple = (dir: string, triple: string, tool: string) =>
  existsSync(join(dir, `${triple}-${tool}${process.platform === "win32" ? ".exe" : ""}`));

/** Where a mingw toolchain is, in order of preference. Reads the disk and PATH only. */
export function locateMingw(ctx: Context): MingwFound | undefined {
  const local = findInstalled(llvmMingwRelease);
  if (local)
    return {
      flavor: "llvm",
      kind: "managed",
      binDir: dirname(local.bin),
      triples: MINGW_TRIPLES.filter(t => hasTriple(dirname(local.bin), t, "clang")),
    };
  for (const t of MINGW_TRIPLES) {
    const clang = which(`${t}-clang`, ctx);
    if (clang)
      return {
        flavor: "llvm",
        kind: "path",
        binDir: dirname(clang),
        triples: MINGW_TRIPLES.filter(x => hasTriple(dirname(clang), x, "clang")),
      };
    const gcc = which(`${t}-gcc`, ctx);
    if (gcc) return { flavor: "gcc", kind: "path", binDir: dirname(gcc), triples: [t] };
  }
  const roots = [ctx.env.W64DEVKIT_HOME, ctx.env.WINLIBS_HOME].filter(Boolean) as string[];
  for (const root of roots) {
    const bin = join(root, "bin");
    if (hasTriple(bin, "x86_64-w64-mingw32", "gcc"))
      return {
        flavor: "gcc",
        kind: root === ctx.env.W64DEVKIT_HOME ? "w64devkit" : "winlibs",
        binDir: bin,
        triples: ["x86_64-w64-mingw32"],
      };
  }
  if (ctx.platform === "win32") {
    for (const sub of ["clang64", "ucrt64", "mingw64"]) {
      const bin = join(ctx.env.MSYS2_ROOT ?? "C:\\msys64", sub, "bin");
      if (hasTriple(bin, "x86_64-w64-mingw32", "gcc") || existsSync(join(bin, "gcc.exe")))
        return { flavor: "gcc", kind: "msys2-readonly", binDir: bin, triples: ["x86_64-w64-mingw32"] };
    }
  }
  return undefined;
}

export const mingwProvider: Provider = {
  id: "mingw",
  description: "mingw-w64 toolchain (llvm-mingw pinned; winlibs, w64devkit, MSYS2 trees detected read-only)",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx): Promise<Detection> {
    const found = locateMingw(ctx);
    if (!found) return missing("buncc install mingw --run  (downloads llvm-mingw, checksum verified)");
    const probe = join(
      found.binDir,
      `${found.triples[0] ?? "x86_64-w64-mingw32"}-${found.flavor === "llvm" ? "clang" : "gcc"}`,
    );
    const version = await probeVersion(probe, ["--version"], ctx);
    const notes = [`${found.kind}: ${found.triples.join(", ") || "no mingw triple prefixed binaries"}`];
    if (found.kind === "msys2-readonly") notes.push("existing MSYS2 tree, used read-only; not modified");
    return { found: true, path: found.binDir, version, notes };
  },
  install: () => ({ commands: [["buncc", "install", "mingw", "--run"]] }),
  async env(ctx) {
    const found = locateMingw(ctx);
    if (!found) return {};
    const triple = found.triples[0] ?? "x86_64-w64-mingw32";
    return { PATH: prependPath(pathVar(ctx), [found.binDir]), ...mingwEnv(found.binDir, triple, found.flavor) };
  },
};

export async function ensureMingw(options: { tag?: string; fetcher?: typeof fetch; dryRun?: boolean } = {}) {
  return installGithubTool(llvmMingwRelease, options);
}

/** Directories of the buncc-managed mingw toolchain (empty when not installed); replaces the hard-coded MSYS2 ucrt64 path. */
export function mingwBinDirs(): string[] {
  const local = findInstalled(llvmMingwRelease);
  return local ? [dirname(local.bin)] : [];
}
