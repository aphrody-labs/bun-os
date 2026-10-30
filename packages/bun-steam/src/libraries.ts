// SPDX-License-Identifier: Apache-2.0
/**
 * Steam library folders (`libraryfolders.vdf`): listing with free space, installed apps from
 * `appmanifest_*.acf`, candidate disks, and moving a library to a faster disk.
 */
import { storage as winStorage } from "./win";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync } from "node:fs";
import { join, parse, resolve } from "node:path";
import { isSteamRunning, readVdf, type ChangePlan, writeVdf } from "./config.js";
import { IS_WINDOWS, isDir, norm, resolveSteamRoot } from "./paths.js";
import { kvObj, kvStr, parseTextKv } from "./vdf.js";

export interface LibraryFolder {
  index: string;
  path: string;
  label: string;
  apps: number;
  freeBytes: number | null;
  totalBytes: number | null;
  isSteamRoot: boolean;
}

const libraryFiles = (steamRoot: string) => [
  join(steamRoot, "config", "libraryfolders.vdf"),
  join(steamRoot, "steamapps", "libraryfolders.vdf"),
];

function space(path: string): { free: number | null; total: number | null } {
  try {
    const s = statfsSync(path);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return { free: null, total: null };
  }
}

/** Library folders of the client with app counts and free space. */
export function listLibraries(steamRoot = resolveSteamRoot()): LibraryFolder[] {
  const doc = libraryFiles(steamRoot).map(readVdf).find(Boolean);
  const folders = kvObj(doc, "libraryfolders") ?? {};
  return Object.entries(folders).flatMap(([index, v]) => {
    if (typeof v === "string") return [];
    const path = norm(kvStr(v, "path") ?? "");
    const { free, total } = space(path);
    return [
      {
        index,
        path,
        label: kvStr(v, "label") ?? "",
        apps: Object.keys(kvObj(v, "apps") ?? {}).length,
        freeBytes: free,
        totalBytes: total,
        isSteamRoot: path.toLowerCase() === norm(steamRoot).toLowerCase(),
      },
    ];
  });
}

export interface InstalledGame {
  appId: number;
  name: string;
  installDir: string;
  library: string;
  sizeOnDisk: number;
  stateFlags: number;
  buildId: string | null;
}

/** Installed games from every library's `appmanifest_*.acf`. */
export function installedGames(steamRoot = resolveSteamRoot()): InstalledGame[] {
  const out: InstalledGame[] = [];
  for (const lib of listLibraries(steamRoot)) {
    const steamapps = join(lib.path, "steamapps");
    if (!isDir(steamapps)) continue;
    for (const f of readdirSync(steamapps)) {
      if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
      try {
        const st = kvObj(parseTextKv(readFileSync(join(steamapps, f), "utf8")), "AppState");
        out.push({
          appId: Number(kvStr(st, "appid")),
          name: kvStr(st, "name") ?? "",
          installDir: norm(join(steamapps, "common", kvStr(st, "installdir") ?? "")),
          library: lib.path,
          sizeOnDisk: Number(kvStr(st, "SizeOnDisk") ?? 0),
          stateFlags: Number(kvStr(st, "StateFlags") ?? 0),
          buildId: kvStr(st, "buildid"),
        });
      } catch {
        /* unreadable manifest */
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Disk {
  root: string;
  type: string;
  freeBytes: number;
  totalBytes: number;
}

/** Fixed disks that can hold a library (Windows drives, Linux mounted block devices). */
export function candidateDisks(): Disk[] {
  if (IS_WINDOWS)
    return winStorage
      .drives()
      .filter(d => d.type === "fixed")
      .map(d => ({
        root: norm(d.root),
        type: d.type,
        freeBytes: d.availableBytes,
        totalBytes: d.totalBytes,
      }));
  const seen = new Set<string>();
  return readFileSync("/proc/mounts", "utf8")
    .split("\n")
    .map(l => l.split(" "))
    .filter(([dev, mnt]) => dev?.startsWith("/dev/") && mnt && !/^\/(boot|snap)/.test(mnt))
    .flatMap(([dev, mnt, type]) => {
      if (seen.has(dev!)) return [];
      seen.add(dev!);
      const { free, total } = space(mnt!);
      return [
        {
          root: mnt!,
          type: type ?? "",
          freeBytes: free ?? 0,
          totalBytes: total ?? 0,
        },
      ];
    });
}

function treeBytes(path: string): number {
  let total = 0;
  for (const e of readdirSync(path, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += statSync(join(e.parentPath, e.name)).size;
  }
  return total;
}

const sameVolume = (a: string, b: string): boolean =>
  IS_WINDOWS
    ? parse(resolve(a)).root.toLowerCase() === parse(resolve(b)).root.toLowerCase()
    : statSync(a).dev === statSync(existsSync(b) ? b : resolve(b, "..")).dev;

/**
 * Moves a library folder (its `steamapps` tree and `libraryfolder.vdf`) to `to` and rewrites
 * `libraryfolders.vdf`. Same-volume moves rename; cross-volume moves copy, verify the byte count,
 * then delete the source. Steam must be closed. The Steam install library cannot move.
 */
export function moveLibrary(
  from: string,
  to: string,
  opts: { steamRoot?: string; dryRun?: boolean; force?: boolean } = {},
): ChangePlan[] {
  const steamRoot = opts.steamRoot ?? resolveSteamRoot();
  const src = norm(resolve(from));
  const dst = norm(resolve(to));
  const lib = listLibraries(steamRoot).find(l => l.path.toLowerCase() === src.toLowerCase());
  if (!lib) throw new Error(`${src} is not a library of ${steamRoot}`);
  if (lib.isSteamRoot)
    throw new Error("the Steam install library cannot move; add a new library on the fast disk instead");
  if (existsSync(join(dst, "steamapps")) && readdirSync(join(dst, "steamapps")).length)
    throw new Error(`${dst}/steamapps already exists and is not empty`);
  const bytes = treeBytes(join(src, "steamapps"));
  const { free } = space(existsSync(dst) ? dst : resolve(dst, ".."));
  if (free !== null && !sameVolume(src, dst) && free < bytes)
    throw new Error(`${dst}: ${free} bytes free, ${bytes} needed`);
  const plans: ChangePlan[] = libraryFiles(steamRoot)
    .filter(f => existsSync(f))
    .map(file => ({
      file: norm(file),
      changes: [{ key: `libraryfolders/${lib.index}/path`, from: src, to: dst }],
      applied: false,
    }));
  plans.unshift({
    file: `${src}/steamapps`,
    changes: [
      {
        key: sameVolume(src, dst) ? "rename" : `copy+verify+delete (${bytes} bytes)`,
        from: `${src}/steamapps`,
        to: `${dst}/steamapps`,
      },
    ],
    applied: false,
  });
  if (opts.dryRun) return plans;
  if (!opts.force && isSteamRunning()) throw new Error("Steam is running; close it before moving a library");

  const move = (a: string, b: string) => {
    if (!existsSync(a)) return;
    if (sameVolume(src, dst)) renameSync(a, b);
    else {
      cpSync(a, b, {
        recursive: true,
        preserveTimestamps: true,
        errorOnExist: true,
      });
      if (statSync(a).isDirectory() && treeBytes(a) !== treeBytes(b))
        throw new Error(`${b}: copy size mismatch, source kept`);
      rmSync(a, { recursive: true, force: true });
    }
  };
  move(join(src, "steamapps"), join(dst, "steamapps"));
  move(join(src, "libraryfolder.vdf"), join(dst, "libraryfolder.vdf"));
  plans[0]!.applied = true;
  for (const plan of plans.slice(1)) {
    const doc = readVdf(plan.file)!;
    const entry = kvObj(doc, "libraryfolders", lib.index);
    if (entry) entry.path = IS_WINDOWS ? dst.replaceAll("/", "\\") : dst;
    writeVdf(plan.file, doc);
    plan.applied = true;
  }
  return plans;
}
