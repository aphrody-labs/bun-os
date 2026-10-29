// SPDX-License-Identifier: Apache-2.0
// Host disposition: ONE home per host (vps, dbfr), no /srv, no /opt. Read from the [layout] table of
// infra/config/host/host-policy.toml, the single source of truth (Rust: aphrody_infra::layout).
import {
  existsSync,
  lchownSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  type Dirent,
} from "node:fs";
import { join, posix, resolve } from "node:path";

const sourcePolicy = resolve(import.meta.dir, "../../../../infra/config/host/host-policy.toml");
const policy = existsSync(sourcePolicy)
  ? Bun.TOML.parse(readFileSync(sourcePolicy, "utf8"))
  : JSON.parse(readFileSync(resolve(import.meta.dir, "../../data/host-layout.json"), "utf8"));

export type LayoutRoot = "src" | "apps" | "build" | "archive" | "state";

export interface HostLayout {
  home: string;
  src: string;
  apps: string;
  build: string;
  archive: string;
  state: string;
  compose: string;
  composeProject: string;
  releasesKeep: number;
  /** Retired location -> replacement, absolute, longest prefix first. */
  retired: [from: string, to: string][];
}

type Json = Record<string, unknown>;
const table = ((policy as Json)["layout"] ?? {}) as Json;

/** `~` and `~/x` against `home`; anything else unchanged. */
export const expandHome = (path: string, home: string): string =>
  path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;

/** The layout with every `~` expanded against `home` (default: the declared host home). */
export function hostLayout(home = String(table["home"])): HostLayout {
  const at = (key: string): string => {
    const value = table[key];
    if (typeof value !== "string") throw new Error(`host-policy.toml: [layout].${key} missing`);
    return expandHome(value, home);
  };
  const retired = Object.entries((table["retired"] ?? {}) as Record<string, string>)
    .map(([from, to]): [string, string] => [expandHome(from, home), expandHome(to, home)])
    .toSorted((a, b) => b[0].length - a[0].length);
  return {
    home,
    src: at("src"),
    apps: at("apps"),
    build: at("build"),
    archive: at("archive"),
    state: at("state"),
    compose: at("compose"),
    composeProject: String(table["compose_project"]),
    releasesKeep: Number(table["releases_keep"]),
    retired,
  };
}

export const HOST_LAYOUT: HostLayout = hostLayout();

/** `<root>/<parts...>` on the host, e.g. hostPath("apps", "demoapp", "shared"). */
export const hostPath = (root: LayoutRoot, ...parts: string[]): string => posix.join(HOST_LAYOUT[root], ...parts);

/** The retired prefix `path` starts with (path-boundary aware), or null. */
export function retiredPrefix(path: string, layout = HOST_LAYOUT): string | null {
  for (const [from] of layout.retired) if (path === from || path.startsWith(`${from}/`)) return from;
  return null;
}

/** Rewrite a retired location (persisted state, old receipts) to its replacement; other paths unchanged. */
export function migratePath(path: string, layout = HOST_LAYOUT): string {
  const from = retiredPrefix(path, layout);
  if (from === null) return path;
  const to = layout.retired.find(([f]) => f === from)![1];
  return `${to}${path.slice(from.length)}`;
}

export interface RetiredLink {
  path: string;
  target: string;
  replacement: string;
}

/**
 * Absolute symlinks under `roots` whose target is a retired location (`current -> /srv/<app>/releases/x`), with their
 * replacement. Symlinks are not followed and the walk stays on the filesystem of each root.
 */
export function retiredLinks(roots: readonly string[], layout = HOST_LAYOUT): RetiredLink[] {
  const found: RetiredLink[] = [];
  const walk = (dir: string, dev: number) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        const replacement = migratePath(target, layout);
        if (replacement !== target) found.push({ path, target, replacement });
      } else if (entry.isDirectory() && lstatSync(path).dev === dev) walk(path, dev);
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root, lstatSync(root).dev);
  return found;
}

/** Points each link at its replacement in place (new link renamed over the old one, owner kept when run as root). */
export function relink(links: readonly RetiredLink[]): void {
  for (const { path, replacement } of links) {
    const tmp = `${path}.relink-${process.pid}`;
    const { uid, gid } = lstatSync(path);
    symlinkSync(replacement, tmp);
    if (process.getuid?.() === 0) lchownSync(tmp, uid, gid);
    renameSync(tmp, path);
  }
}
