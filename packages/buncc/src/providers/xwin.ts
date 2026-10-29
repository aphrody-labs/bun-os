/**
 * xwin: download the MSVC CRT and Windows SDK from Microsoft's CDN and lay them out for cross-compiling to Windows with
 * clang-cl / lld-link from Linux and macOS (https://github.com/Jake-Shadle/xwin). The fork wrapped this in
 * scripts/build/winsysroot.ts and a cross mode of its own (removed with the fork); xwin is the maintained tool for the same job.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GithubToolSpec } from "./_github.ts";
import { toolsDir } from "./_shared.ts";
import { toolProvider } from "./_tool.ts";
import { run } from "../process.ts";

export const xwinRelease: GithubToolSpec = {
  id: "xwin",
  repo: "Jake-Shadle/xwin",
  binary: "xwin",
  asset(tag, platform, arch) {
    const v = tag.replace(/^v/, "");
    const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
    if (!cpu) return undefined;
    if (platform === "win32") return arch === "x64" ? `xwin-${v}-x86_64-pc-windows-msvc.tar.gz` : undefined;
    if (platform === "linux") return `xwin-${v}-${cpu}-unknown-linux-musl.tar.gz`;
    return `xwin-${v}-${cpu}-apple-darwin.tar.gz`;
  },
};

export const xwinProvider = toolProvider({
  id: "xwin",
  description: "xwin: MSVC CRT + Windows SDK sysroot for cross-compiling to Windows",
  binary: "xwin",
  versionArgs: ["--version"],
  platforms: ["linux", "darwin", "win32"],
  packages: { pacman: "xwin" },
  github: xwinRelease,
  manual: "cargo install xwin --locked   (or call xwinProvider.ensure() for the checksum-verified release)",
  extraEnv: () => ({ XWIN_ACCEPT_LICENSE: "1" }),
});

export type XwinArch = "x86_64" | "aarch64" | "x86" | "arm";

export function defaultSysroot(): string {
  return join(toolsDir(), "winsysroot");
}

/**
 * `xwin --accept-license splat --output <dir>`. `--accept-license` accepts Microsoft's licence for the CRT and SDK, so the
 * caller must opt in explicitly.
 */
export function splatArgs(o: {
  output?: string;
  arch?: XwinArch[];
  sdkVersion?: string;
  crtVersion?: string;
  cacheDir?: string;
  acceptLicense: boolean;
}): string[] {
  if (!o.acceptLicense)
    throw new Error("xwin splat downloads Microsoft-licensed files; pass acceptLicense: true to accept the licence");
  const args = ["--accept-license"];
  if (o.cacheDir) args.push("--cache-dir", o.cacheDir);
  args.push("splat", "--output", o.output ?? defaultSysroot(), "--arch", (o.arch ?? ["x86_64", "aarch64"]).join(","));
  if (o.sdkVersion) args.push("--sdk-version", o.sdkVersion);
  if (o.crtVersion) args.push("--crt-version", o.crtVersion);
  return args;
}

const TRIPLE: Record<XwinArch, string> = {
  x86_64: "x86_64-pc-windows-msvc",
  aarch64: "aarch64-pc-windows-msvc",
  x86: "i686-pc-windows-msvc",
  arm: "thumbv7a-pc-windows-msvc",
};

/** A splat is complete when the CRT headers and the SDK `um` import libraries of every requested arch exist. */
export function isSplatComplete(root: string, arches: XwinArch[] = ["x86_64"]): boolean {
  if (!existsSync(join(root, "crt", "include", "vcruntime.h"))) return false;
  if (
    !existsSync(join(root, "sdk", "include", "um", "Windows.h")) &&
    !existsSync(join(root, "sdk", "include", "um", "windows.h"))
  )
    return false;
  return arches.every(a => existsSync(join(root, "sdk", "lib", "um", a)) && existsSync(join(root, "crt", "lib", a)));
}

/**
 * Environment for cargo and the `cc` crate to target Windows from a non-Windows host with the splat at `root`:
 * clang-cl compiles, llvm-lib archives, lld-link links; include and library dirs are passed explicitly.
 */
export function crossEnv(root: string, arches: XwinArch[] = ["x86_64", "aarch64"]): Record<string, string> {
  const env: Record<string, string> = { XWIN_SYSROOT: root };
  const incs = ["crt/include", "sdk/include/ucrt", "sdk/include/um", "sdk/include/shared", "sdk/include/winrt"].map(
    p => `/imsvc${join(root, p)}`,
  );
  for (const arch of arches) {
    const triple = TRIPLE[arch];
    const id = triple.replace(/-/g, "_");
    const up = triple.replace(/-/g, "_").toUpperCase();
    const flags = [`--target=${triple}`, "-Wno-unused-command-line-argument", "-fuse-ld=lld-link", ...incs].join(" ");
    env[`CC_${id}`] = "clang-cl";
    env[`CXX_${id}`] = "clang-cl";
    env[`AR_${id}`] = "llvm-lib";
    env[`CFLAGS_${id}`] = flags;
    env[`CXXFLAGS_${id}`] = flags;
    env[`CARGO_TARGET_${up}_LINKER`] = "lld-link";
    env[`CARGO_TARGET_${up}_RUSTFLAGS`] = ["crt/lib", "sdk/lib/um", "sdk/lib/ucrt"]
      .map(p => `-Lnative=${join(root, p, arch)}`)
      .join(" ");
  }
  return env;
}

/** Download the sysroot. Only runs when incomplete. */
export async function splat(xwin: string, o: Parameters<typeof splatArgs>[0]) {
  const output = o.output ?? defaultSysroot();
  const arches = o.arch ?? ["x86_64", "aarch64"];
  if (isSplatComplete(output, arches)) return { output, status: "already-complete" as const };
  const result = await run([xwin, ...splatArgs(o)], { output: "inherit" });
  if (result.code !== 0) throw new Error(`xwin splat exited with ${result.code}`);
  if (!isSplatComplete(output, arches)) throw new Error(`xwin splat finished but ${output} is incomplete`);
  return { output, status: "created" as const };
}
