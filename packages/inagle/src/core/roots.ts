// SPDX-License-Identifier: MIT
/**
 * Checkout roots shared by the inagle/azalee CLIs and maintenance scripts.
 *
 * Bun OS owns the IEVR libraries and game data.
 * Resolve all source paths from this checkout; only game-data storage can be
 * relocated independently.
 */

import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return path.resolve(value);
  }
  return undefined;
}

function moduleDir(): string {
  return typeof import.meta.dir === "string" ? import.meta.dir : path.dirname(fileURLToPath(import.meta.url));
}

/** Bun OS checkout root (`packages/inagle/src/core` → four levels up). */
export function iecodeRoot(): string {
  return path.resolve(moduleDir(), "../../../..");
}

/** Path inside the Bun OS checkout. */
export function iecodePath(...parts: string[]): string {
  return path.join(iecodeRoot(), ...parts);
}

/** Game data root (`<bun-os>/data`), relocatable on its own. */
export function iecodeDataRoot(): string {
  return firstEnv(["DATA_ROOT", "DATA_PATH", "NIE_DATA_ROOT"]) ?? path.join(iecodeRoot(), "data");
}

/** Path inside the IECODE game data root. */
export function iecodeDataPath(...parts: string[]): string {
  return path.join(iecodeDataRoot(), ...parts);
}

/** Source tree integrated into the Bun OS checkout. */
export function sourceRoot(): string {
  return iecodeRoot();
}

/** Web app data root; override with WEB_APP_ROOT. */
export function webAppRoot(): string {
  return firstEnv(["WEB_APP_ROOT"]) ?? path.join(sourceRoot(), "apps", "web");
}

/** Path inside the web app root. */
export function webAppPath(...parts: string[]): string {
  return path.join(webAppRoot(), ...parts);
}

/** Current user's home directory, without assuming a host account name. */
export function userHome(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
}
