// SPDX-License-Identifier: 0BSD
/**
 * COSMIC configuration defaults for the desktop composition, after libcosmic's cosmic-config crate
 * (pop-os/libcosmic 95236a944bfd, cosmic-config/src/lib.rs). Layout: one RON file per key,
 *   user    $XDG_CONFIG_HOME/cosmic/<AppId>/v<N>/<key>
 *   system  <data dir>/cosmic/<AppId>/v<N>/<key>   (/usr/share/cosmic/... via $XDG_DATA_DIRS)
 * `get` reads the user file, else the user file of version N-1, else the system default of version N only.
 * Bun OS ships its overrides as system defaults (cosmic/defaults/**), so a user's own changes always win and
 * the file set is plain data. Nothing here was run against a COSMIC session (no Linux host); the resolver is
 * a reading of cosmic-config, not a binding to it. Epoch pin: pop-os/cosmic-epoch epoch-1.11.0 (e98f8289a2,
 * 2026-10-20).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/** cosmic-config's sanitize_name: no empty, ".", ".." or path-like components. */
export function sanitize(name: string): string {
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || name.startsWith("."))
    throw new Error(`invalid cosmic-config name: ${JSON.stringify(name)}`);
  return name;
}

export interface CosmicDirs {
  /** $XDG_CONFIG_HOME/cosmic */
  userDir: string;
  /** $XDG_DATA_HOME/cosmic first, then each $XDG_DATA_DIRS entry + /cosmic. Only the first dir holding the app version dir is used. */
  systemDirs: string[];
}

const readKey = async (path: string) => (existsSync(path) ? (await readFile(path, "utf8")).trim() : undefined);

export interface ResolvedKey {
  value: string;
  source: "user" | "user-previous" | "system";
  path: string;
}

export async function resolveKey(
  dirs: CosmicDirs,
  appId: string,
  version: number,
  key: string,
): Promise<ResolvedKey | undefined> {
  sanitize(appId);
  sanitize(key);
  const user = join(dirs.userDir, appId, `v${version}`, key);
  const mine = await readKey(user);
  if (mine !== undefined) return { value: mine, source: "user", path: user };
  if (version > 1) {
    const previous = join(dirs.userDir, appId, `v${version - 1}`, key);
    const old = await readKey(previous);
    if (old !== undefined) return { value: old, source: "user-previous", path: previous };
  }
  const systemRoot = dirs.systemDirs.find(d => existsSync(join(d, appId, `v${version}`)));
  if (systemRoot) {
    const system = join(systemRoot, appId, `v${version}`, key);
    const value = await readKey(system);
    if (value !== undefined) return { value, source: "system", path: system };
  }
  return undefined;
}

/** Files of cosmic/defaults, as [AppId, version, key, absolute path]. */
export async function listDefaults(
  root: string,
): Promise<{ appId: string; version: number; key: string; path: string }[]> {
  const out: { appId: string; version: number; key: string; path: string }[] = [];
  for (const appId of existsSync(root) ? await readdir(root) : []) {
    for (const v of await readdir(join(root, appId))) {
      const m = v.match(/^v(\d+)$/);
      if (!m) throw new Error(`${appId}/${v}: expected v<N>`);
      for (const key of await readdir(join(root, appId, v)))
        out.push({ appId, version: Number(m[1]), key, path: join(root, appId, v, key) });
    }
  }
  return out;
}

/**
 * Write the defaults into `<out>/<AppId>/v<N>/<key>`; `out` is `<root>/usr/share/cosmic` when staging a rootfs.
 * Trailing whitespace is trimmed: cosmic-config writes keys without a newline.
 */
export async function installDefaults(defaultsRoot: string, out: string): Promise<string[]> {
  const written: string[] = [];
  for (const d of await listDefaults(defaultsRoot)) {
    const target = join(out, d.appId, `v${d.version}`, d.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, (await readFile(d.path, "utf8")).trim());
    written.push(relative(out, target).replaceAll("\\", "/"));
  }
  return written;
}
