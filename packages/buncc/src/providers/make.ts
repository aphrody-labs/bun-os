/** GNU make, Ninja, Meson and pkgconf: the four tools the fork's build-essential plugin pinned. */
import type { GithubToolSpec } from "./_github.ts";
import { toolProvider } from "./_tool.ts";

export const ninjaRelease: GithubToolSpec = {
  id: "ninja",
  repo: "ninja-build/ninja",
  binary: "ninja",
  asset(_tag, platform, arch) {
    if (platform === "win32") return arch === "arm64" ? "ninja-winarm64.zip" : "ninja-win.zip";
    if (platform === "darwin") return "ninja-mac.zip";
    return arch === "arm64" ? "ninja-linux-aarch64.zip" : "ninja-linux.zip";
  },
};

export const ninjaProvider = toolProvider({
  id: "ninja",
  description: "Ninja build executor",
  binary: "ninja",
  versionArgs: ["--version"],
  packages: {
    winget: "Ninja-build.Ninja",
    pacman: "ninja",
    apt: "ninja-build",
    dnf: "ninja-build",
    apk: "samurai",
    brew: "ninja",
  },
  github: ninjaRelease,
});

export const makeProvider = toolProvider({
  id: "make",
  description: "GNU make",
  binary: "make",
  versionArgs: ["--version"],
  packages: { winget: "ezwinports.make", pacman: "make", apt: "make", dnf: "make", apk: "make", brew: "make" },
});

export const mesonProvider = toolProvider({
  id: "meson",
  description: "Meson build system",
  binary: "meson",
  versionArgs: ["--version"],
  packages: { winget: "mesonbuild.meson", pacman: "meson", apt: "meson", dnf: "meson", apk: "meson", brew: "meson" },
});

export const pkgconfProvider = toolProvider({
  id: "pkgconf",
  description: "pkgconf (pkg-config compatible)",
  binary: "pkgconf",
  versionArgs: ["--version"],
  packages: {
    winget: "pkgconf.pkgconf",
    pacman: "pkgconf",
    apt: "pkgconf",
    dnf: "pkgconf-pkg-config",
    apk: "pkgconf",
    brew: "pkgconf",
  },
});

export function makeArgs(o: { dir?: string; target?: string; jobs?: number; vars?: Record<string, string> }): string[] {
  const args: string[] = [];
  if (o.dir) args.push("-C", o.dir);
  if (o.jobs) args.push(`-j${o.jobs}`);
  for (const [k, v] of Object.entries(o.vars ?? {})) args.push(`${k}=${v}`);
  if (o.target) args.push(o.target);
  return args;
}

export function ninjaArgs(o: { dir?: string; targets?: string[]; jobs?: number; keepGoing?: number }): string[] {
  const args: string[] = [];
  if (o.dir) args.push("-C", o.dir);
  if (o.jobs) args.push("-j", String(o.jobs));
  if (o.keepGoing !== undefined) args.push("-k", String(o.keepGoing));
  return [...args, ...(o.targets ?? [])];
}

export function mesonSetupArgs(o: {
  source: string;
  build: string;
  buildType?: string;
  prefix?: string;
  options?: Record<string, string>;
}): string[] {
  const args = ["setup", o.build, o.source];
  if (o.buildType) args.push(`--buildtype=${o.buildType}`);
  if (o.prefix) args.push(`--prefix=${o.prefix}`);
  for (const [k, v] of Object.entries(o.options ?? {})) args.push(`-D${k}=${v}`);
  return args;
}
