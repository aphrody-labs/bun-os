/**
 * vcpkg: locate or bootstrap the C/C++ package manager, map the build target to a triplet and export the environment
 * (CMAKE_TOOLCHAIN_FILE, triplets, binary cache) that CMake and Rust build scripts read.
 * https://learn.microsoft.com/vcpkg/commands/common-options and https://learn.microsoft.com/vcpkg/users/binarycaching
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cacheDir } from "../lock.ts";
import { exeSuffix, hostArch, missing, pinFromToolchain, probeVersion, which } from "./_shared.ts";
import type { Detection, Platform, Provider } from "./types.ts";

export type VcpkgArch = "x64" | "x86" | "arm64" | "arm";

export function triplet(
  platform: Platform,
  arch: VcpkgArch = hostArch(),
  linkage: "dynamic" | "static" = "dynamic",
): string {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "osx" : "linux";
  if (platform !== "win32" && (arch === "x86" || arch === "arm"))
    throw new Error(`vcpkg has no ${arch}-${os} triplet in the default set`);
  const base = `${arch}-${os}`;
  if (linkage === "static") return platform === "win32" ? `${base}-static` : base; // non-Windows triplets are static by default
  return platform === "win32" ? base : `${base}-dynamic`;
}

/** VCPKG_ROOT, else a `vendor/vcpkg` or `vcpkg` directory in `from` or a parent, else the directory of `vcpkg` on PATH. */
export function findRoot(
  from: string,
  env: Record<string, string | undefined> = Bun.env,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const isRoot = (d: string) =>
    exists(join(d, ".vcpkg-root")) || exists(join(d, "scripts", "buildsystems", "vcpkg.cmake"));
  if (env.VCPKG_ROOT && isRoot(env.VCPKG_ROOT)) return resolve(env.VCPKG_ROOT);
  let dir = resolve(from);
  for (;;) {
    for (const rel of [join("vendor", "vcpkg"), "vcpkg"]) if (isRoot(join(dir, rel))) return join(dir, rel);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const exe = Bun.which("vcpkg");
  if (exe && isRoot(dirname(exe))) return dirname(exe);
  return undefined;
}

export function toolchainFile(root: string): string {
  return join(root, "scripts", "buildsystems", "vcpkg.cmake");
}

export function binaryCacheDir(env: Record<string, string | undefined> = Bun.env): string {
  return env.VCPKG_DEFAULT_BINARY_CACHE ?? join(cacheDir(), "vcpkg", "archives");
}

export function vcpkgEnv(
  root: string,
  platform: Platform,
  arch: VcpkgArch = hostArch(),
  o: { linkage?: "dynamic" | "static"; hostTriplet?: string; cache?: string } = {},
): Record<string, string> {
  const t = triplet(platform, arch, o.linkage);
  return {
    VCPKG_ROOT: root,
    VCPKG_DEFAULT_TRIPLET: t,
    VCPKG_DEFAULT_HOST_TRIPLET: o.hostTriplet ?? triplet(platform, hostArch(), "dynamic"),
    VCPKG_DEFAULT_BINARY_CACHE: o.cache ?? binaryCacheDir(),
    VCPKG_DISABLE_METRICS: "1",
    CMAKE_TOOLCHAIN_FILE: toolchainFile(root),
  };
}

/** `vcpkg install` for a manifest directory (`vcpkg.json`) or for named packages. */
export function installArgs(o: {
  manifestRoot?: string;
  packages?: string[];
  triplet?: string;
  installRoot?: string;
  featureFlags?: string[];
}): string[] {
  const args = ["install"];
  if (o.manifestRoot) args.push("--x-manifest-root", o.manifestRoot);
  if (o.triplet) args.push("--triplet", o.triplet);
  if (o.installRoot) args.push("--x-install-root", o.installRoot);
  args.push("--no-print-usage");
  if (o.featureFlags?.length) args.push(`--feature-flags=${o.featureFlags.join(",")}`);
  return [...args, ...(o.packages ?? [])];
}

/** Baseline commit a manifest pins (`builtin-baseline`), the version of the whole port tree. */
export function manifestBaseline(manifestRoot: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(manifestRoot, "vcpkg.json"), "utf8")) as { "builtin-baseline"?: string })[
      "builtin-baseline"
    ];
  } catch {
    return undefined;
  }
}

export function bootstrapCommands(root: string, platform: Platform): string[][] {
  const script = platform === "win32" ? join(root, "bootstrap-vcpkg.bat") : join(root, "bootstrap-vcpkg.sh");
  return [[script, "-disableMetrics"]];
}

export function cloneCommands(root: string): string[][] {
  return [["git", "clone", "--depth", "1", "https://github.com/microsoft/vcpkg", root]];
}

export function vcpkgExe(root: string): string {
  return join(root, `vcpkg${exeSuffix}`);
}

export const vcpkgProvider: Provider = {
  id: "vcpkg",
  description: "vcpkg C/C++ package manager",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx): Promise<Detection> {
    const root = findRoot(ctx.root, ctx.env);
    if (!root)
      return missing(
        `git clone https://github.com/microsoft/vcpkg <dir> && <dir>${ctx.platform === "win32" ? "\\bootstrap-vcpkg.bat" : "/bootstrap-vcpkg.sh"} -disableMetrics, then set VCPKG_ROOT`,
      );
    const exe = existsSync(vcpkgExe(root)) ? vcpkgExe(root) : which("vcpkg", ctx);
    if (!exe) return { found: false, path: root, fixHint: bootstrapCommands(root, ctx.platform)[0]!.join(" ") };
    const version = await probeVersion(exe, ["version"], ctx);
    return { found: true, path: exe, version, notes: [`VCPKG_ROOT=${root}`] };
  },
  install(ctx) {
    const root = findRoot(ctx.root, ctx.env) ?? join(ctx.root, "vendor", "vcpkg");
    const have = existsSync(join(root, ".vcpkg-root"));
    return { commands: [...(have ? [] : cloneCommands(root)), ...bootstrapCommands(root, ctx.platform)] };
  },
  async env(ctx) {
    const root = findRoot(ctx.root, ctx.env);
    return root ? vcpkgEnv(root, ctx.platform) : {};
  },
  pin: ctx => pinFromToolchain(ctx, "vcpkg"),
};
