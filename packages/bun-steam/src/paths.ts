// SPDX-License-Identifier: Apache-2.0
/**
 * Steam locations on Windows and Linux: client root, steamcmd, user data and compatibility tool
 * directories. Every lookup accepts an explicit override and never guesses a workstation path.
 */
import { registry as winRegistry } from "./win";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const IS_WINDOWS = process.platform === "win32";
export const HKCU_STEAM = String.raw`HKCU\Software\Valve\Steam`;
export const DEFAULT_WINDOWS_ROOT = "C:/Program Files (x86)/Steam";

/** Forward slashes, the form Steam itself writes in its VDF files. */
export const norm = (p: string): string => p.replaceAll("\\", "/");

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Linux client roots in Steam's own search order (native, legacy symlink, Flatpak, Snap). */
export function linuxSteamRoots(home = homedir()): string[] {
  return [
    join(home, ".local/share/Steam"),
    join(home, ".steam/steam"),
    join(home, ".steam/root"),
    join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    join(home, "snap/steam/common/.local/share/Steam"),
  ];
}

/**
 * Steam client root: `explicit`, then `STEAM_ROOT`, then the registry `SteamPath` (Windows) or the
 * first existing Linux root, then the platform default.
 */
export function resolveSteamRoot(explicit?: string): string {
  const pick = explicit ?? process.env.STEAM_ROOT;
  if (pick) return norm(resolve(pick));
  if (IS_WINDOWS) {
    try {
      const v = winRegistry.get(HKCU_STEAM, "SteamPath");
      if (v && typeof v.value === "string" && v.value) return norm(resolve(v.value));
    } catch {
      /* registry unavailable */
    }
    return DEFAULT_WINDOWS_ROOT;
  }
  // A configured client (config/config.vdf) wins over empty directories left by installers.
  const roots = linuxSteamRoots();
  return norm(roots.find(r => existsSync(join(r, "config", "config.vdf"))) ?? roots.find(isDir) ?? roots[0]!);
}

/** `%LOCALAPPDATA%/Steam` (htmlcache, local.vdf). */
export function defaultAppDataRoot(): string {
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? homedir(), "AppData", "Local");
  return norm(join(local, "Steam"));
}

/** Linux `registry.vdf`, the client's replacement for the Windows registry. */
export const linuxRegistryVdf = (home = homedir()): string => join(home, ".steam/registry.vdf");

export interface SteamcmdLocation {
  /** steamcmd executable or launcher script. */
  exe: string;
  /** Directory holding `config/config.vdf` (session cache) and `steamapps`. */
  home: string;
}

/**
 * steamcmd: `explicit`, then `STEAMCMD`, then `C:\steamcmd\steamcmd.exe` (Windows) or
 * `/usr/games/steamcmd` (Debian/Ubuntu package), then `PATH`. The data home is the executable
 * directory on Windows; on Linux the first of `STEAMCMD_HOME`, `~/.steam/steamcmd`, `~/Steam`,
 * `~/.local/share/Steam` that holds `config/config.vdf`.
 */
export function findSteamcmd(explicit?: string): SteamcmdLocation | null {
  const candidates = [
    explicit,
    process.env.STEAMCMD,
    IS_WINDOWS ? "C:/steamcmd/steamcmd.exe" : "/usr/games/steamcmd",
    Bun.which("steamcmd") ?? undefined,
  ].filter((p): p is string => !!p);
  const exe = candidates.find(p => existsSync(p));
  if (!exe) return null;
  if (IS_WINDOWS) return { exe: norm(exe), home: norm(resolve(exe, "..")) };
  const home = homedir();
  const homes = [
    process.env.STEAMCMD_HOME,
    join(home, ".steam/steamcmd"),
    join(home, "Steam"),
    join(home, ".local/share/Steam"),
  ].filter((p): p is string => !!p);
  const found = homes.find(h => existsSync(join(h, "config", "config.vdf"))) ?? homes[0]!;
  return { exe: norm(exe), home: norm(found) };
}

/**
 * Directories Steam scans for custom compatibility tools: `<root>/compatibilitytools.d`, the
 * system `/usr/share/steam/compatibilitytools.d`, and `STEAM_EXTRA_COMPAT_TOOLS_PATHS`.
 */
export function compatToolDirs(steamRoot = resolveSteamRoot()): string[] {
  const extra = (process.env.STEAM_EXTRA_COMPAT_TOOLS_PATHS ?? "").split(":").filter(Boolean);
  return [
    ...extra,
    join(steamRoot, "compatibilitytools.d"),
    ...(IS_WINDOWS ? [] : ["/usr/share/steam/compatibilitytools.d"]),
  ].map(norm);
}

/** `userdata/<accountid>` directories of the client. */
export function userDataDirs(steamRoot = resolveSteamRoot()): string[] {
  const base = join(steamRoot, "userdata");
  try {
    return readdirSync(base)
      .filter(d => /^\d+$/.test(d) && d !== "0")
      .map(d => norm(join(base, d)));
  } catch {
    return [];
  }
}
