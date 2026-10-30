// SPDX-License-Identifier: Apache-2.0
/**
 * Steam client configuration across hosts: auto-login flags (Windows registry through
 * `reg.exe`, Linux `registry.vdf`), `loginusers.vdf`, per-game compatibility tool mapping
 * (`config.vdf` `CompatToolMapping`) and running-client detection.
 *
 * Credential contract: only account names and boolean flags are read or written. Passwords,
 * refresh tokens, `ConnectCache` values and `local.vdf` are never read, logged or returned.
 */
import { processes as winProcesses, registry as winRegistry } from "./win";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HKCU_STEAM, IS_WINDOWS, linuxRegistryVdf, norm, resolveSteamRoot } from "./paths.js";
import { type KvObject, kvEnsure, kvKey, kvObj, kvStr, parseTextKv, stringifyTextKv } from "./vdf.js";

/** Reads and parses a text VDF file, or `null` when it does not exist. */
export function readVdf(path: string): KvObject | null {
  try {
    return parseTextKv(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Writes a text VDF file atomically (temporary file in the same directory, then rename). */
export function writeVdf(path: string, doc: KvObject): void {
  const tmp = `${path}.bun-steam-${process.pid}`;
  writeFileSync(tmp, stringifyTextKv(doc));
  renameSync(tmp, path);
}

/** True when a Steam client process runs (`steam.exe` on Windows, `steam` on Linux). */
export function isSteamRunning(): boolean {
  if (IS_WINDOWS) {
    try {
      return winProcesses.list().some(p => p.name.toLowerCase() === "steam.exe");
    } catch {
      return false;
    }
  }
  try {
    return readdirSync("/proc").some(pid => {
      if (!/^\d+$/.test(pid)) return false;
      try {
        return readFileSync(`/proc/${pid}/comm`, "utf8").trim() === "steam";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export interface ClientConfig {
  platform: NodeJS.Platform;
  steamRoot: string;
  /** `registry` (Windows HKCU) or the Linux `registry.vdf` path. */
  source: string;
  autoLoginUser: string | null;
  rememberPassword: boolean | null;
  steamPath: string | null;
  runningAppId: number | null;
  running: boolean;
}

const LINUX_REG_PATH = ["Registry", "HKCU", "Software", "Valve", "Steam"];

function regValue(name: string): string | number | null {
  try {
    const v = winRegistry.get(HKCU_STEAM, name);
    if (!v) return null;
    return typeof v.value === "string" || typeof v.value === "number" ? v.value : null;
  } catch {
    return null;
  }
}

/** Auto-login and install state of the Steam client on this host. */
export function readClientConfig(steamRoot = resolveSteamRoot()): ClientConfig {
  if (IS_WINDOWS) {
    const remember = regValue("RememberPassword");
    const running = regValue("RunningAppID");
    return {
      platform: process.platform,
      steamRoot,
      source: "registry",
      autoLoginUser: (regValue("AutoLoginUser") as string | null) || null,
      rememberPassword: remember === null ? null : Number(remember) === 1,
      steamPath: regValue("SteamPath") as string | null,
      runningAppId: running === null ? null : Number(running),
      running: isSteamRunning(),
    };
  }
  const path = linuxRegistryVdf();
  const steam = kvObj(readVdf(path), ...LINUX_REG_PATH);
  const remember = kvStr(steam, "RememberPassword");
  const running = kvStr(steam, "RunningAppID");
  return {
    platform: process.platform,
    steamRoot,
    source: path,
    autoLoginUser: kvStr(steam, "AutoLoginUser") || null,
    rememberPassword: remember === null ? null : remember === "1",
    steamPath: kvStr(steam, "SteamPath"),
    runningAppId: running === null ? null : Number(running),
    running: isSteamRunning(),
  };
}

export interface LoginUser {
  steamId: string;
  accountName: string;
  personaName: string | null;
  rememberPassword: boolean;
  mostRecent: boolean;
  allowAutoLogin: boolean;
  wantsOfflineMode: boolean;
  timestamp: number | null;
}

export const loginUsersPath = (steamRoot = resolveSteamRoot()): string =>
  norm(join(steamRoot, "config", "loginusers.vdf"));

/** Accounts remembered by the client (`config/loginusers.vdf`): names and flags only. */
export function loginUsers(steamRoot = resolveSteamRoot()): LoginUser[] {
  const users = kvObj(readVdf(loginUsersPath(steamRoot)), "users") ?? {};
  return Object.entries(users).flatMap(([steamId, u]) =>
    typeof u === "string"
      ? []
      : [
          {
            steamId,
            accountName: kvStr(u, "AccountName") ?? "",
            personaName: kvStr(u, "PersonaName"),
            rememberPassword: kvStr(u, "RememberPassword") === "1",
            mostRecent: kvStr(u, "MostRecent") === "1",
            allowAutoLogin: kvStr(u, "AllowAutoLogin") === "1",
            wantsOfflineMode: kvStr(u, "WantsOfflineMode") === "1",
            timestamp: Number(kvStr(u, "Timestamp")) || null,
          },
        ],
  );
}

export interface ChangePlan {
  file: string;
  changes: { key: string; from: string | null; to: string }[];
  applied: boolean;
}

function assertClientStopped(force?: boolean): void {
  if (!force && isSteamRunning())
    throw new Error("Steam is running and rewrites its configuration on exit; close it first (or pass --force)");
}

/**
 * Makes `account` the auto-login account: `AutoLoginUser` + `RememberPassword` (registry or
 * `registry.vdf`) and `MostRecent`/`AllowAutoLogin` in `loginusers.vdf`. The account must already be
 * remembered by the client; no credential is touched. `dryRun` returns the plan only.
 */
export function setAutoLogin(
  account: string,
  opts: { steamRoot?: string; dryRun?: boolean; force?: boolean } = {},
): ChangePlan[] {
  const steamRoot = opts.steamRoot ?? resolveSteamRoot();
  const usersPath = loginUsersPath(steamRoot);
  const doc = readVdf(usersPath) ?? {};
  const users = kvEnsure(doc, "users");
  const match = Object.entries(users).find(
    ([, u]) => typeof u !== "string" && kvStr(u, "AccountName")?.toLowerCase() === account.toLowerCase(),
  );
  if (!match) throw new Error(`${account} is not remembered by this Steam client; sign in once in Steam first`);
  if (!opts.dryRun) assertClientStopped(opts.force);
  const usersPlan: ChangePlan = {
    file: usersPath,
    changes: [],
    applied: false,
  };
  for (const [id, u] of Object.entries(users)) {
    if (typeof u === "string") continue;
    const target = id === match[0];
    for (const [key, value] of [
      ["MostRecent", target ? "1" : "0"],
      ...(target ? [["AllowAutoLogin", "1"]] : []),
    ] as const) {
      const k = kvKey(u, key) ?? key;
      const from = typeof u[k] === "string" ? (u[k] as string) : null;
      if (from === value) continue;
      usersPlan.changes.push({ key: `users/${id}/${key}`, from, to: value });
      u[k] = value;
    }
  }
  const regPlan: ChangePlan = {
    file: IS_WINDOWS ? HKCU_STEAM : linuxRegistryVdf(),
    changes: [],
    applied: false,
  };
  const current = readClientConfig(steamRoot);
  const name = kvStr(match[1], "AccountName")!;
  if (current.autoLoginUser !== name)
    regPlan.changes.push({
      key: "AutoLoginUser",
      from: current.autoLoginUser,
      to: name,
    });
  if (current.rememberPassword !== true)
    regPlan.changes.push({
      key: "RememberPassword",
      from: current.rememberPassword === null ? null : "0",
      to: "1",
    });
  if (opts.dryRun) return [regPlan, usersPlan];

  if (usersPlan.changes.length) {
    writeVdf(usersPath, doc);
    usersPlan.applied = true;
  }
  if (regPlan.changes.length) {
    if (IS_WINDOWS) {
      winRegistry.set(HKCU_STEAM, "AutoLoginUser", name, "REG_SZ");
      winRegistry.set(HKCU_STEAM, "RememberPassword", 1, "REG_DWORD");
    } else {
      const regDoc = readVdf(regPlan.file) ?? {};
      const steam = kvEnsure(regDoc, ...LINUX_REG_PATH);
      steam[kvKey(steam, "AutoLoginUser") ?? "AutoLoginUser"] = name;
      steam[kvKey(steam, "RememberPassword") ?? "RememberPassword"] = "1";
      writeVdf(regPlan.file, regDoc);
    }
    regPlan.applied = true;
  }
  return [regPlan, usersPlan];
}

export const clientConfigPath = (steamRoot = resolveSteamRoot()): string =>
  norm(join(steamRoot, "config", "config.vdf"));

const STEAM_STORE = ["InstallConfigStore", "Software", "Valve", "Steam"];

export interface CompatMapping {
  appId: string;
  tool: string;
  config: string;
  priority: string;
}

/** Per-game compatibility tool choices (`CompatToolMapping`); app `0` is the global default. */
export function compatToolMapping(configPath = clientConfigPath()): CompatMapping[] {
  const map = kvObj(readVdf(configPath), ...STEAM_STORE, "CompatToolMapping");
  return Object.entries(map ?? {}).flatMap(([appId, v]) =>
    typeof v === "string"
      ? []
      : [
          {
            appId,
            tool: kvStr(v, "name") ?? "",
            config: kvStr(v, "config") ?? "",
            priority: kvStr(v, "priority") ?? "",
          },
        ],
  );
}

/**
 * Selects the compatibility tool of one game (`appId`, or `0` for every Windows title) in
 * `config.vdf`. `tool` is the internal name (`proton_9`, `proton_experimental`, `GE-Proton10-20`,
 * `proton-cachyos-...`); an empty string removes the mapping.
 */
export function setCompatTool(
  appId: string,
  tool: string,
  opts: { configPath?: string; dryRun?: boolean; force?: boolean } = {},
): ChangePlan {
  const file = opts.configPath ?? clientConfigPath();
  const doc = readVdf(file);
  if (!doc) throw new Error(`${file}: not found`);
  const map = kvEnsure(doc, ...STEAM_STORE, "CompatToolMapping");
  const current = kvObj(map, appId);
  const from = current ? kvStr(current, "name") : null;
  const plan: ChangePlan = {
    file,
    changes: [{ key: `CompatToolMapping/${appId}/name`, from, to: tool }],
    applied: false,
  };
  if (from === tool || opts.dryRun) return plan;
  assertClientStopped(opts.force);
  if (tool) map[appId] = { name: tool, config: "", priority: "250" };
  else delete map[kvKey(map, appId) ?? appId];
  writeVdf(file, doc);
  plan.applied = true;
  return plan;
}
