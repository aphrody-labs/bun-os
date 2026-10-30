/**
 * wine and proton: run Windows programs on Linux/macOS hosts. Wine cannot be replaced, so this provider UNIFIES it:
 * it detects or provisions a pinned build, owns the prefixes (one per name under the buncc cache) and installs
 * dxvk/vkd3d-proton into them. Not applicable on Windows (detect says so).
 *
 * Pinned sources (gh api, 2026-10-29): Kron4ek/Wine-Builds 11.20 (wine-11.20-staging-amd64.tar.xz),
 * CachyOS/proton-cachyos cachyos-11.0-20261015-slr, doitsujin/dxvk v3.1.1, HansKristian-Work/vkd3d-proton v3.1.
 * The aphrody-labs forks (vendor/wine-cachyos, vendor/proton-cachyos, vendor/dxvk, vendor/vkd3d-proton) are the source
 * of truth for patches; the provider consumes upstream binary releases and does not build them.
 * Nothing here ran on Linux in the session that wrote it: CI must exercise it.
 */
import { join } from "node:path";
import { findInstalled, installGithubTool, type GithubToolSpec } from "./_github.ts";
import { cacheDir } from "../lock.ts";
import { missing, pathVar, prependPath, probeVersion, which } from "./_shared.ts";
import type { Context, Detection, Provider } from "./types.ts";

export const wineBuilds: GithubToolSpec = {
  id: "wine",
  repo: "Kron4ek/Wine-Builds",
  binary: "wine",
  asset: (tag, platform, arch) =>
    platform === "linux" && arch === "x64"
      ? `wine-${tag}-staging-amd64.tar.xz`
      : platform === "linux" && arch === "x86"
        ? `wine-${tag}-staging-x86.tar.xz`
        : undefined,
};
export const protonCachyos: GithubToolSpec = {
  id: "proton",
  repo: "CachyOS/proton-cachyos",
  binary: "proton",
  asset: (_tag, platform, arch) =>
    platform === "linux"
      ? new RegExp(`^proton-cachyos-.*-${arch === "arm64" ? "arm64" : "x86_64"}\\.tar\\.xz$`)
      : undefined,
};
export const dxvkRelease: GithubToolSpec = {
  id: "dxvk",
  repo: "doitsujin/dxvk",
  binary: "setup_dxvk.sh",
  asset: (tag, platform) => (platform === "win32" ? undefined : `dxvk-${tag.replace(/^v/, "")}.tar.gz`),
};
export const vkd3dProtonRelease: GithubToolSpec = {
  id: "vkd3d-proton",
  repo: "HansKristian-Work/vkd3d-proton",
  binary: "setup_vkd3d_proton.sh",
  asset: (tag, platform) => (platform === "win32" ? undefined : `vkd3d-proton-${tag.replace(/^v/, "")}.tar.zst`),
};

export function prefixRoot(): string {
  return join(cacheDir(), "wine", "prefixes");
}
export function prefixPath(name: string): string {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`invalid prefix name: ${name}`);
  return join(prefixRoot(), name);
}

export interface PrefixOptions {
  arch?: "win64" | "win32";
  /** Quiet by default: WINEDEBUG=-all. */
  debug?: string;
  dllOverrides?: string;
}

/** Environment of a Wine prefix. Pure. */
export function wineEnv(name: string, o: PrefixOptions = {}): Record<string, string> {
  return {
    WINEPREFIX: prefixPath(name),
    WINEARCH: o.arch ?? "win64",
    WINEDEBUG: o.debug ?? "-all",
    ...(o.dllOverrides ? { WINEDLLOVERRIDES: o.dllOverrides } : {}),
  };
}

/** Commands that create a prefix and (optionally) put DXVK / vkd3d-proton in it. Pure; the caller runs them. */
export function prefixPlan(
  wineBin: string,
  name: string,
  o: PrefixOptions & { dxvkDir?: string; vkd3dDir?: string } = {},
): { env: Record<string, string>; commands: string[][] } {
  const commands: string[][] = [[join(wineBin, "..", "wineboot"), "--init"]];
  if (o.dxvkDir) commands.push(["sh", join(o.dxvkDir, "setup_dxvk.sh"), "install", "--symlink"]);
  if (o.vkd3dDir) commands.push(["sh", join(o.vkd3dDir, "setup_vkd3d_proton.sh"), "install", "--symlink"]);
  return { env: wineEnv(name, o), commands };
}

export function wineRun(wineBin: string, name: string, program: string, args: string[] = []) {
  return { command: [wineBin, program, ...args], env: wineEnv(name) };
}

/** Proton is driven through its `proton` script with the Steam compat variables it requires. Pure. */
export function protonRun(protonDir: string, name: string, program: string, args: string[] = [], verb = "run") {
  const data = join(cacheDir(), "proton", "compat", name);
  return {
    command: [join(protonDir, "proton"), verb, program, ...args],
    env: {
      STEAM_COMPAT_DATA_PATH: data,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: join(cacheDir(), "proton", "steam"),
      PROTON_LOG: "0",
    } as Record<string, string>,
  };
}

const notApplicable: Detection = {
  found: false,
  notes: ["not applicable on Windows (Wine/Proton run Windows programs on Linux and macOS)"],
};

export const wineProvider: Provider = {
  id: "wine",
  description: "Wine (system or pinned Kron4ek build) with buncc-owned prefixes, dxvk and vkd3d-proton",
  platforms: ["linux", "darwin"],
  async detect(ctx: Context): Promise<Detection> {
    if (ctx.platform === "win32") return notApplicable;
    const local = findInstalled(wineBuilds);
    const bin = local?.bin ?? which("wine64", ctx) ?? which("wine", ctx);
    if (!bin)
      return missing(
        "buncc install wine --run (pinned Kron4ek build, Linux x64) or your distribution's wine/wine-staging",
      );
    return { found: true, path: bin, version: await probeVersion(bin, ["--version"], ctx) };
  },
  install: () => ({ commands: [["buncc", "install", "wine", "--run"]] }),
  async env(ctx): Promise<Record<string, string>> {
    const local = findInstalled(wineBuilds);
    return local ? { PATH: prependPath(pathVar(ctx), [join(local.dir, "bin")]) } : {};
  },
};

export const protonProvider: Provider = {
  id: "proton",
  description: "Proton (CachyOS build pinned) for Linux hosts; Steam compat variables set per prefix",
  platforms: ["linux"],
  async detect(ctx: Context): Promise<Detection> {
    if (ctx.platform === "win32") return notApplicable;
    const local = findInstalled(protonCachyos);
    if (local) return { found: true, path: local.dir, version: local.version };
    return missing("buncc install proton --run");
  },
  install: () => ({ commands: [["buncc", "install", "proton", "--run"]] }),
  env: async () => ({}),
};

export async function ensureWine(
  kind: "wine" | "proton" | "dxvk" | "vkd3d-proton",
  options: { tag?: string; fetcher?: typeof fetch; dryRun?: boolean } = {},
) {
  const spec = { wine: wineBuilds, proton: protonCachyos, dxvk: dxvkRelease, "vkd3d-proton": vkd3dProtonRelease }[kind];
  return installGithubTool(spec, options);
}
