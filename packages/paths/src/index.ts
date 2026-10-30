// SPDX-License-Identifier: Apache-2.0
import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ExternalCheckout = "aphrody-py" | "iecode" | "rg" | "source" | "bxc" | "yolo" | "m3" | "bun" | "material";

const rootMarkers = ["rust-toolchain.toml", "Cargo.toml", "package.json"] as const;
/** Find this Aphrody checkout by its root manifests, starting at a file or directory. */
export function findWorkspaceRoot(from?: string, env: Record<string, string | undefined> = process.env): string {
  const explicit = from === undefined && (env.APHRODY_WORKSPACE_ROOT?.trim() || env.APHRODY_ROOT?.trim());
  if (explicit) {
    const root = resolve(explicit);
    if (!isDirectory(root)) throw new Error(`Configured Aphrody root is not a directory: ${root}`);
    return root;
  }
  const start = from ?? process.cwd();
  let current = resolve(start);
  if (!existsSync(current) || !isDirectory(current)) current = dirname(current);
  while (true) {
    if (rootMarkers.every(marker => existsSync(join(current, marker)))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Aphrody workspace root not found above ${start}`);
    current = parent;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve a repository-owned path without assuming the user's checkout location. */
export function workspacePath(...parts: string[]): string {
  return resolve(findWorkspaceRoot(), ...parts);
}

/** Resolve integrated owners from the selected workspace's source layout. */
export function checkoutRoot(
  checkout: ExternalCheckout,
  env: Record<string, string | undefined> = process.env,
): string {
  const root = findWorkspaceRoot(undefined, env);
  switch (checkout) {
    case "aphrody-py":
      return join(root, "py");
    case "iecode":
    case "rg":
      return root;
    case "source":
      return resolve(root, ".cache", "upstream");
    case "bxc":
    case "yolo":
    case "m3":
    case "material":
      return root;
    case "bun":
      return join(root, "sources/bun");
  }
}

/** Root of the Inazuma sources integrated in this checkout. */
export function iecodeRoot(): string {
  return checkoutRoot("iecode");
}

/** Game data root, relocatable independently from the game source checkout. */
export function iecodeDataPath(...parts: string[]): string {
  const explicit = process.env.DATA_PATH?.trim() || process.env.DATA_ROOT?.trim() || process.env.NIE_DATA_ROOT?.trim();
  return resolve(explicit || checkoutPath("iecode", "data"), ...parts);
}

/** Inagle package root in the Bun OS checkout. */
export function inagleRoot(): string {
  const root = findWorkspaceRoot();
  return resolve(root, "packages", "inagle");
}

/** Resolve under a sibling checkout. */
export function checkoutPath(checkout: ExternalCheckout, ...parts: string[]): string {
  return resolve(checkoutRoot(checkout), ...parts);
}

/** Resolve under the current account's home directory. */
export function homePath(...parts: string[]): string {
  return resolve(homedir(), ...parts);
}

/** Canonical user-owned agent plugin store, independent of any source checkout. */
export function pluginStorePath(...parts: string[]): string {
  return resolve(process.env.APHRODY_PLUGINS_ROOT?.trim() || statePath("plugins"), ...parts);
}

/** Resolve in the host's temporary directory (TMPDIR/TEMP aware). */
export function tempPath(...parts: string[]): string {
  return resolve(process.env.APHRODY_TMP_DIR?.trim() || tmpdir(), ...parts);
}

/** Resolve the shared Aphrody state root; matches the Rust APHRODY_HOME contract. */
export function statePath(...parts: string[]): string {
  const explicit = process.env.APHRODY_HOME?.trim();
  if (explicit) return resolve(explicit, ...parts);
  return homePath(".aphrody", ...parts);
}

/** Resolve in the host's cache directory. */
export function cachePath(...parts: string[]): string {
  const explicit = process.env.APHRODY_CACHE_DIR?.trim();
  if (explicit) return resolve(explicit, ...parts);
  if (process.platform === "win32")
    return resolve(process.env.LOCALAPPDATA || homePath("AppData", "Local"), "Aphrody", "cache", ...parts);
  if (process.platform === "darwin") return homePath("Library", "Caches", "Aphrody", ...parts);
  return resolve(process.env.XDG_CACHE_HOME || homePath(".cache"), "aphrody", ...parts);
}

/** Read the host/user environment home, including Windows USERPROFILE fallback. */
export function userHome(): string {
  return homedir();
}

/** Convert a platform path to a stable slash-separated representation for manifests. */
export function portablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

// Keep an eager module URL helper available to callers that are launched outside cwd.
export function moduleDirectory(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl));
}

/**
 * Locate a native binary built from this checkout: the `envName` override, then
 * `target/{release,debug}` of the workspace, `CARGO_TARGET_DIR` and the shared Aphrody Cargo
 * target directories, then `PATH`.
 */
export function findNativeBinary(name: string, envName: string, from?: string): string | undefined {
  const override = process.env[envName];
  if (override && existsSync(override)) return override;
  let root: string | undefined;
  try {
    root = findWorkspaceRoot(from);
  } catch {
    root = undefined;
  }
  const local = process.env.LOCALAPPDATA;
  const bases = [
    root && join(root, "target"),
    process.env.CARGO_TARGET_DIR,
    local && join(local, "Aphrody", "cache", "cargo-target"),
    local && join(local, "aphrody", "target"),
  ].filter((base): base is string => !!base);
  const file = process.platform === "win32" ? `${name}.exe` : name;
  for (const base of bases)
    for (const profile of ["release", "debug"]) {
      const hit = join(base, profile, file);
      if (existsSync(hit)) return hit;
    }
  return Bun.which(name) ?? undefined;
}
