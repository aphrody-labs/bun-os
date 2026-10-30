// SPDX-License-Identifier: Apache-2.0
/**
 * Local Steam installation scanner: install tree, libraries, app manifests, PICS caches, depot
 * manifests, PE metadata, client logs, user data (playtime, Steam Cloud state, library cache),
 * the Windows registry whitelist and running processes, all written to the SQLite database.
 *
 * Privacy contract: files that carry authentication material or personal data are never read.
 * They are recorded in `secret_artifact` with path, size and mtime only, and the `file` row
 * carries `sensitive = 1`. `localconfig.vdf` is parsed only for per-app playtime keys.
 */
import type { Database } from "bun:sqlite";
import { parsePe } from "./pe";
import { processes as winProcesses, registry as winRegistry } from "./win";
import { readFileSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseAppInfo, parsePackageInfo } from "./appinfo.js";
import { clearScanTables } from "./db.js";
import { detectFileType, type FileType } from "./filetype.js";
import { type KvObject, kvInt, kvObj, kvStr, parseTextKv } from "./vdf.js";
import { FILE_FLAG_DIRECTORY, parseDepotManifest } from "./manifest.js";
import { defaultAppDataRoot, HKCU_STEAM, isDir, norm, resolveSteamRoot } from "./paths.js";

export interface ScanOptions {
  db: Database;
  /** Steam install root; defaults to the registry `SteamPath`, then `C:/Program Files (x86)/Steam`. */
  root?: string | undefined;
  /** `%LOCALAPPDATA%/Steam` (htmlcache, local.vdf); sizes only. */
  appData?: string | undefined;
  /** Largest file hashed with SHA-256 (bytes). 0 disables hashing. */
  hashMax?: number | undefined;
  /** Extra library folders to scan beyond `libraryfolders.vdf`. */
  libraries?: string[] | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface ScanSummary {
  scanId: number;
  steamRoot: string;
  files: number;
  bytes: number;
  apps: number;
  appInfo: number;
  packages: number;
  manifests: number;
  peFiles: number;
  logEvents: number;
  users: number;
  secrets: number;
  durationMs: number;
}

const STEAMID64_BASE = 76561197960265728n;
const HKLM_STEAM = String.raw`HKLM\SOFTWARE\WOW6432Node\Valve\Steam`;
/** Registry values that are safe to record (no account names, no auth state). */
const HKCU_WHITELIST = new Set([
  "SteamPath",
  "SteamExe",
  "Language",
  "RunningAppID",
  "SourceModInstallPath",
  "SuppressAutoRun",
  "Restart",
  "DPIScaling",
  "SmoothScrollWebViews",
  "CompletedOOBEStage1",
  "AlreadyRetriedOfflineMode",
  "StartupModeTmpIsValid",
  "Rate",
]);
const HKLM_WHITELIST = new Set(["InstallPath", "SteamPID", "SteamExe", "SteamPath"]);

interface SecretRule {
  category: string;
  note: string;
  test: (rel: string) => boolean;
}
/** Paths never read for content. `rel` is the lower-cased forward-slash path under the root. */
const SECRET_RULES: SecretRule[] = [
  {
    category: "auth",
    note: "client config (ConnectCache, auth material)",
    test: r => r === "config/config.vdf",
  },
  {
    category: "auth",
    note: "login users (account names, tokens)",
    test: r => r === "config/loginusers.vdf",
  },
  {
    category: "auth",
    note: "local client state (auth material)",
    test: r => r === "local.vdf" || r.endsWith("/local.vdf"),
  },
  {
    category: "auth",
    note: "Steam Guard sentry file",
    test: r => /(^|\/)ssfn[^/]*$/.test(r),
  },
  {
    category: "personal",
    note: "avatar cache (account identifiers)",
    test: r => r.startsWith("config/avatarcache/"),
  },
  {
    category: "personal",
    note: "per-user client config",
    test: r => /^userdata\/\d+\/config\/localconfig\.vdf$/.test(r),
  },
  {
    category: "personal",
    note: "friends / chat state",
    test: r => /^userdata\/\d+\/config\/(friends|chat)/.test(r) || /^userdata\/\d+\/friends\//.test(r),
  },
  {
    category: "browser",
    note: "CEF cache (cookies, storage, sessions)",
    test: r => r.startsWith("htmlcache/") || r.includes("/htmlcache/"),
  },
  {
    category: "auth",
    note: "licence cache (account)",
    test: r => /^userdata\/\d+\/config\/licensecache$/.test(r),
  },
  {
    category: "personal",
    note: "shared per-user config",
    test: r => /^userdata\/\d+\/7\/remote\/sharedconfig\.vdf$/.test(r),
  },
  {
    category: "personal",
    note: "crash minidump (may embed memory)",
    test: r => r.startsWith("dumps/") && r.endsWith(".dmp"),
  },
];

const secretRule = (rel: string): SecretRule | null => {
  const lower = rel.toLowerCase();
  for (const rule of SECRET_RULES) if (rule.test(lower)) return rule;
  return null;
};

const now = () => new Date().toISOString();
const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
};

interface RootRow {
  id: number;
  kind: string;
  path: string;
}

/** Runs a full scan. Rebuilds every scan table; API/store tables are untouched. */
export async function scanSteam(opts: ScanOptions): Promise<ScanSummary> {
  const started = performance.now();
  const { db } = opts;
  const log = opts.log ?? (() => {});
  const hashMax = opts.hashMax ?? 64 * 1024 * 1024;
  const steamRoot = resolveSteamRoot(opts.root);
  const appData = norm(opts.appData ?? defaultAppDataRoot());

  db.run("BEGIN");
  clearScanTables(db);
  const scanId = Number(
    (
      db
        .query("INSERT INTO scan(started_at, host, steam_root) VALUES (?, ?, ?) RETURNING id")
        .get(now(), hostname(), steamRoot) as {
        id: number;
      }
    ).id,
  );
  db.run("COMMIT");

  const insRoot = db.query("INSERT INTO root(kind, path, exists_) VALUES (?, ?, ?) RETURNING id");
  const addRoot = (kind: string, path: string): RootRow => {
    const exists = isDir(path) ? 1 : 0;
    const { id } = insRoot.get(kind, path, exists) as { id: number };
    return { id, kind, path };
  };

  // Libraries first: they define app ownership for the file walk.
  const libraries = readLibraryFolders(db, steamRoot, opts.libraries ?? []);
  const apps = readAppManifests(db, libraries);
  log(`libraries ${libraries.length}, installed apps ${apps.length}`);

  const owner = buildOwnerResolver(steamRoot, apps);
  const roots: RootRow[] = [addRoot("install", steamRoot)];
  for (const lib of libraries) if (norm(lib.path) !== steamRoot) roots.push(addRoot("library", norm(lib.path)));
  roots.push(addRoot("appdata", appData));

  let files = 0;
  let bytes = 0;
  let peFiles = 0;
  let secrets = 0;
  const peCandidates: { fileId: number; path: string }[] = [];
  for (const root of roots) {
    if (!isDir(root.path)) continue;
    const r = await walkRoot(db, root, {
      hashMax,
      owner,
      contentFree: root.kind === "appdata",
      log,
    });
    files += r.files;
    bytes += r.bytes;
    secrets += r.secrets;
    peCandidates.push(...r.pe);
    db.run("UPDATE root SET file_count = ?, byte_total = ? WHERE id = ?", [r.files, r.bytes, root.id]);
  }
  log(`files ${files} (${(bytes / 1e9).toFixed(2)} GB), secret artifacts ${secrets}`);

  db.run("BEGIN");
  for (const c of peCandidates) if (recordPe(db, c.fileId, c.path)) peFiles++;
  db.run("COMMIT");
  log(`pe files ${peFiles}`);

  const appInfo = await readAppInfo(db, steamRoot);
  const packages = await readPackageInfo(db, steamRoot);
  const manifests = await readDepotManifests(db, steamRoot);
  log(`appinfo ${appInfo}, packages ${packages}, depot manifests ${manifests}`);
  fillAppExecutables(db, apps, steamRoot);

  const logEvents = await readLogs(db, steamRoot);
  const users = await readUserData(db, steamRoot);
  readLibraryCache(db, steamRoot);
  readRegistry(db);
  readProcesses(db);
  log(`log events ${logEvents}, users ${users}`);

  db.run("UPDATE scan SET finished_at = ?, file_count = ?, byte_total = ? WHERE id = ?", [now(), files, bytes, scanId]);
  return {
    scanId,
    steamRoot,
    files,
    bytes,
    apps: apps.length,
    appInfo,
    packages,
    manifests,
    peFiles,
    logEvents,
    users,
    secrets,
    durationMs: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------
// Libraries and app manifests

interface Library {
  idx: number;
  path: string;
}
interface InstalledApp {
  appid: number;
  libraryIdx: number;
  installdir: string | null;
  installPath: string | null;
}

function readLibraryFolders(db: Database, steamRoot: string, extra: string[]): Library[] {
  const libs: Library[] = [];
  const ins = db.query(
    "INSERT OR REPLACE INTO library(idx, path, label, contentid, total_size, update_clean_bytes_tally, time_last_update_verified, app_count) VALUES (?,?,?,?,?,?,?,?)",
  );
  const file = join(steamRoot, "config", "libraryfolders.vdf");
  const alt = join(steamRoot, "steamapps", "libraryfolders.vdf");
  const text = readTextSync(file) ?? readTextSync(alt);
  if (text) {
    const kv = kvObj(parseTextKv(text), "libraryfolders") ?? {};
    for (const [idx, v] of Object.entries(kv)) {
      if (typeof v === "string" || !/^\d+$/.test(idx)) continue;
      const path = norm(kvStr(v, "path") ?? "");
      if (!path) continue;
      const apps = kvObj(v, "apps");
      ins.run(
        Number(idx),
        path,
        kvStr(v, "label"),
        kvStr(v, "contentid"),
        kvInt(v, "totalsize"),
        kvInt(v, "update_clean_bytes_tally"),
        kvInt(v, "time_last_update_verified"),
        apps ? Object.keys(apps).length : 0,
      );
      libs.push({ idx: Number(idx), path });
    }
  }
  if (libs.length === 0) {
    ins.run(0, steamRoot, null, null, null, null, null, null);
    libs.push({ idx: 0, path: steamRoot });
  }
  let next = Math.max(...libs.map(l => l.idx)) + 1;
  for (const p of extra) {
    const path = norm(resolve(p));
    if (libs.some(l => l.path.toLowerCase() === path.toLowerCase())) continue;
    ins.run(next, path, "extra", null, null, null, null, null);
    libs.push({ idx: next++, path });
  }
  return libs;
}

function readAppManifests(db: Database, libs: Library[]): InstalledApp[] {
  const out: InstalledApp[] = [];
  const insApp =
    db.query(`INSERT OR REPLACE INTO app(appid, library_idx, name, universe, state_flags, installdir, install_path,
    last_updated, last_played, size_on_disk, staging_size, buildid, target_buildid, bytes_to_download, bytes_downloaded,
    bytes_to_stage, bytes_staged, auto_update_behavior, scheduled_auto_update, language, betakey, manifest_path, downloading_bytes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insDepot = db.query(
    "INSERT OR REPLACE INTO app_depot(appid, depotid, state, manifest, size, dlcappid, owner_appid) VALUES (?,?,?,?,?,?,?)",
  );
  for (const lib of libs) {
    const steamapps = join(lib.path, "steamapps");
    if (!isDir(steamapps)) continue;
    for (const name of new Bun.Glob("appmanifest_*.acf").scanSync({
      cwd: steamapps,
    })) {
      const path = join(steamapps, name);
      const text = readTextSync(path);
      if (!text) continue;
      const st = kvObj(parseTextKv(text), "AppState");
      if (!st) continue;
      const appid = kvInt(st, "appid") ?? Number(name.match(/\d+/)?.[0] ?? 0);
      const installdir = kvStr(st, "installdir");
      const installPath = installdir ? norm(join(steamapps, "common", installdir)) : null;
      const downloading = norm(join(steamapps, "downloading", String(appid)));
      const downloadingBytes = isDir(downloading) ? dirBytes(downloading) : null;
      insApp.run(
        appid,
        lib.idx,
        kvStr(st, "name"),
        kvInt(st, "Universe"),
        kvInt(st, "StateFlags"),
        installdir,
        installPath && isDir(installPath) ? installPath : null,
        kvInt(st, "LastUpdated"),
        kvInt(st, "LastPlayed"),
        kvInt(st, "SizeOnDisk"),
        kvInt(st, "StagingSize"),
        kvInt(st, "buildid"),
        kvInt(st, "TargetBuildID"),
        kvInt(st, "BytesToDownload"),
        kvInt(st, "BytesDownloaded"),
        kvInt(st, "BytesToStage"),
        kvInt(st, "BytesStaged"),
        kvInt(st, "AutoUpdateBehavior"),
        kvInt(st, "ScheduledAutoUpdate"),
        kvStr(st, "UserConfig", "language"),
        kvStr(st, "UserConfig", "betakey") ?? kvStr(st, "MountedConfig", "betakey"),
        norm(path),
        downloadingBytes,
      );
      for (const state of ["InstalledDepots", "StagedDepots"]) {
        const depots = kvObj(st, state) ?? {};
        for (const [depotid, d] of Object.entries(depots)) {
          insDepot.run(
            appid,
            Number(depotid),
            state === "InstalledDepots" ? "installed" : "staged",
            kvStr(d, "manifest"),
            kvInt(d, "size"),
            kvInt(d, "dlcappid"),
            null,
          );
        }
      }
      for (const [depotid, ownerApp] of Object.entries(kvObj(st, "SharedDepots") ?? {})) {
        insDepot.run(appid, Number(depotid), "shared", null, null, null, toInt(ownerApp));
      }
      out.push({ appid, libraryIdx: lib.idx, installdir, installPath });
    }
  }
  return out;
}

/** Fills `app.exe_path` from the first Windows launch entry whose executable exists on disk. */
function fillAppExecutables(db: Database, apps: InstalledApp[], steamRoot: string): void {
  const q = db.query(
    "SELECT executable, oslist FROM app_info_launch WHERE appid = ? ORDER BY CASE WHEN oslist IS NULL OR oslist LIKE '%windows%' THEN 0 ELSE 1 END, idx",
  );
  const upd = db.query("UPDATE app SET exe_path = ? WHERE appid = ?");
  for (const app of apps) {
    // An unfinished install keeps its files under steamapps/downloading/<appid>.
    const bases = [app.installPath, norm(join(steamRoot, "steamapps", "downloading", String(app.appid)))].filter(
      Boolean,
    ) as string[];
    const rows = q.all(app.appid) as { executable: string | null }[];
    search: for (const base of bases) {
      for (const row of rows) {
        if (!row.executable) continue;
        const p = norm(join(base, row.executable));
        try {
          if (statSync(p).isFile()) {
            upd.run(p, app.appid);
            break search;
          }
        } catch {
          /* candidate missing */
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// File walk

type OwnerResolver = (rel: string) => number | null;

function buildOwnerResolver(steamRoot: string, apps: InstalledApp[]): OwnerResolver {
  const byInstallDir = new Map<string, number>();
  for (const a of apps) if (a.installdir) byInstallDir.set(a.installdir.toLowerCase(), a.appid);
  return rel => {
    const lower = rel.toLowerCase();
    let m = lower.match(/^steamapps\/common\/([^/]+)\//);
    if (m) return byInstallDir.get(m[1]!) ?? null;
    m = lower.match(/^steamapps\/(?:downloading|temp|shadercache|workshop\/content|compatdata)\/(\d+)\//);
    if (m) return Number(m[1]);
    m = lower.match(/^steamapps\/appmanifest_(\d+)\.acf$/);
    if (m) return Number(m[1]);
    m = lower.match(/^userdata\/\d+\/(\d+)\//);
    if (m) return Number(m[1]);
    m = lower.match(/^appcache\/librarycache\/(\d+)\//);
    if (m) return Number(m[1]);
    m = lower.match(/^depotcache\/(\d+)_/);
    if (m) return Number(m[1]);
    void steamRoot;
    return null;
  };
}

interface WalkResult {
  files: number;
  bytes: number;
  secrets: number;
  pe: { fileId: number; path: string }[];
}

async function walkRoot(
  db: Database,
  root: RootRow,
  o: {
    hashMax: number;
    owner: OwnerResolver;
    contentFree: boolean;
    log: (m: string) => void;
  },
): Promise<WalkResult> {
  const insFile =
    db.query(`INSERT OR REPLACE INTO file(root_id, rel_path, top_dir, ext, size, mtime, kind, mime, owner_appid, sensitive, sha256)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`);
  const insSecret = db.query(
    "INSERT OR REPLACE INTO secret_artifact(root_id, rel_path, category, size, mtime, note) VALUES (?,?,?,?,?,?)",
  );
  const insDir = db.query(
    "INSERT OR REPLACE INTO dir_size(root_id, rel_path, depth, file_count, byte_total) VALUES (?,?,?,?,?)",
  );
  const dirs = new Map<string, { files: number; bytes: number }>();
  const result: WalkResult = { files: 0, bytes: 0, secrets: 0, pe: [] };
  const glob = new Bun.Glob("**/*");
  let batch = 0;
  db.run("BEGIN");
  for await (const rel of glob.scan({
    cwd: root.path,
    dot: true,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    const relPath = norm(rel);
    const abs = join(root.path, rel);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const size = st.size;
    const mtime = Math.floor(st.mtimeMs);
    const ext = extname(relPath).slice(1).toLowerCase();
    const top = relPath.includes("/") ? relPath.slice(0, relPath.indexOf("/")) : "";
    const rule =
      root.kind === "appdata"
        ? (secretRule(relPath) ?? {
            category: "browser",
            note: "AppData Steam client state",
            test: () => true,
          })
        : secretRule(relPath);
    const sensitive = rule !== null;
    let type: FileType;
    let sha: string | null = null;
    if (sensitive || o.contentFree) {
      type = detectFileType(new Uint8Array(0), ext, size);
      if (type.kind === "empty" && size > 0) type = { kind: ext ? ext : "binary", mime: "application/octet-stream" };
    } else {
      try {
        const f = Bun.file(abs);
        const prefix = new Uint8Array(await f.slice(0, Math.min(size, 4096)).arrayBuffer());
        type = detectFileType(prefix, ext, size);
        if (o.hashMax > 0 && size <= o.hashMax) {
          const hasher = new Bun.CryptoHasher("sha256");
          if (size <= 4096) hasher.update(prefix);
          else hasher.update(await f.arrayBuffer());
          sha = hasher.digest("hex");
        }
      } catch {
        type = { kind: "unreadable", mime: "application/octet-stream" };
      }
    }
    const ownerAppid = o.owner(relPath);
    const { id } = insFile.get(
      root.id,
      relPath,
      top,
      ext,
      size,
      mtime,
      type.kind,
      type.mime,
      ownerAppid,
      sensitive ? 1 : 0,
      sha,
    ) as { id: number };
    if (rule) {
      insSecret.run(root.id, relPath, rule.category, size, mtime, rule.note);
      result.secrets++;
    }
    if (type.kind.startsWith("pe") && !sensitive && !o.contentFree) result.pe.push({ fileId: id, path: abs });
    result.files++;
    result.bytes += size;
    let dir = dirname(relPath);
    while (dir && dir !== ".") {
      const d = dirs.get(dir) ?? { files: 0, bytes: 0 };
      d.files++;
      d.bytes += size;
      dirs.set(dir, d);
      dir = dirname(dir);
    }
    if (++batch % 2000 === 0) {
      db.run("COMMIT");
      db.run("BEGIN");
      o.log(`  ${root.kind}: ${result.files} files`);
    }
  }
  for (const [rel, d] of dirs) {
    const depth = rel.split("/").length;
    if (depth <= 4) insDir.run(root.id, rel, depth, d.files, d.bytes);
  }
  db.run("COMMIT");
  return result;
}

function dirBytes(path: string): number {
  let total = 0;
  for (const rel of new Bun.Glob("**/*").scanSync({
    cwd: path,
    dot: true,
    onlyFiles: true,
  })) {
    try {
      total += statSync(join(path, rel)).size;
    } catch {
      /* vanished */
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// PE metadata (src/pe.ts)

function recordPe(db: Database, fileId: number, path: string): boolean {
  let info: Record<string, unknown>;
  try {
    if (statSync(path).size > 256 * 1024 * 1024) return false;
    const parsed = parsePe(readFileSync(path)) as unknown as Record<string, unknown> | null;
    if (!parsed) return false;
    info = parsed;
  } catch {
    return false;
  }
  const imports = (info.imports as { module: string; functions?: string[] }[] | undefined) ?? [];
  const exportsList = (info.exports as unknown[] | undefined) ?? [];
  const version =
    (info.version as {
      strings?: Record<string, string>;
      fileVersion?: string;
      productVersion?: string;
    } | null) ?? null;
  const strings = version?.strings ?? {};
  const auth =
    (info.authenticode as {
      signer?: string;
      issuer?: string;
      certificates?: number;
    } | null) ?? null;
  const importCount = imports.reduce((n, m) => n + (m.functions?.length ?? 0), 0);
  const importsJson = JSON.stringify(imports.map(m => ({ module: m.module, count: m.functions?.length ?? 0 })));
  db.query(
    `INSERT OR REPLACE INTO pe_file(file_id, kind, machine, bits, subsystem, timestamp, image_size, entry_rva, is_dotnet,
    file_version, product_version, company, product, description, original_filename, signer, issuer, certificates,
    import_count, export_count, imports_steam_api, imports_json, warnings) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    fileId,
    str(info.kind),
    str(info.machine),
    toInt(info.bits),
    str(info.subsystem),
    toInt(info.timestamp),
    toInt(info.imageSize),
    toInt(info.entryRva),
    info.isDotnet ? 1 : 0,
    version?.fileVersion ?? null,
    version?.productVersion ?? null,
    strings.CompanyName ?? null,
    strings.ProductName ?? null,
    strings.FileDescription ?? null,
    strings.OriginalFilename ?? null,
    auth?.signer ?? null,
    auth?.issuer ?? null,
    auth?.certificates ?? null,
    importCount,
    exportsList.length,
    imports.some(m => /steam_api|steamclient|steam_api64/i.test(m.module)) ? 1 : 0,
    importsJson,
    JSON.stringify((info.warnings as unknown[] | undefined) ?? []),
  );
  return true;
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// ---------------------------------------------------------------------------------------------
// PICS caches

/** Indexes `appcache/appinfo.vdf` (PICS app info, depots, branches, launch entries). */
export async function readAppInfo(db: Database, steamRoot: string): Promise<number> {
  const path = join(steamRoot, "appcache", "appinfo.vdf");
  const f = Bun.file(path);
  if (!(await f.exists())) return 0;
  let parsed;
  try {
    parsed = parseAppInfo(new Uint8Array(await f.arrayBuffer()));
  } catch {
    return 0;
  }
  const ins =
    db.query(`INSERT OR REPLACE INTO app_info(appid, info_state, last_updated, pics_token, change_number, sha1, binary_sha1, name, type,
    oslist, osarch, developer, publisher, homepage, installdir, release_state, steam_release_date, parent, depot_count, branch_count,
    launch_count, kv_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insDepot =
    db.query(`INSERT OR REPLACE INTO app_info_depot(appid, depotid, name, oslist, osarch, language, dlcappid, depotfromapp,
    shared_install, public_gid, public_size, public_download, max_size, encrypted_manifests) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insBranch = db.query(
    "INSERT OR REPLACE INTO app_info_branch(appid, branch, buildid, timeupdated, description, pwdrequired) VALUES (?,?,?,?,?,?)",
  );
  const insLaunch =
    db.query(`INSERT OR REPLACE INTO app_info_launch(appid, idx, executable, arguments, type, oslist, osarch, description, workingdir)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  db.run("BEGIN");
  for (const a of parsed.apps) {
    const root = kvObj(a.kv, "appinfo") ?? a.kv;
    const common = kvObj(root, "common");
    const config = kvObj(root, "config");
    const depots = kvObj(root, "depots") ?? {};
    const branches = kvObj(depots, "branches") ?? {};
    const launch = kvObj(config, "launch") ?? {};
    const depotIds = Object.keys(depots).filter(k => /^\d+$/.test(k));
    ins.run(
      a.appid,
      a.infoState,
      a.lastUpdated,
      a.picsToken.toString(),
      a.changeNumber,
      a.sha1,
      a.binarySha1,
      kvStr(common, "name"),
      kvStr(common, "type"),
      kvStr(common, "oslist"),
      kvStr(common, "osarch"),
      firstAssoc(common, "developer"),
      firstAssoc(common, "publisher"),
      kvStr(common, "homepage"),
      kvStr(config, "installdir"),
      kvStr(common, "releasestate"),
      kvInt(common, "steam_release_date"),
      kvInt(common, "parent"),
      depotIds.length,
      Object.keys(branches).length,
      Object.keys(launch).length,
      JSON.stringify(root),
    );
    for (const id of depotIds) {
      const d = kvObj(depots, id);
      if (!d) continue;
      insDepot.run(
        a.appid,
        Number(id),
        kvStr(d, "name"),
        kvStr(d, "config", "oslist"),
        kvStr(d, "config", "osarch"),
        kvStr(d, "config", "language"),
        kvInt(d, "dlcappid"),
        kvInt(d, "depotfromapp"),
        kvInt(d, "sharedinstall"),
        kvStr(d, "manifests", "public", "gid") ?? kvStr(d, "manifests", "public"),
        kvInt(d, "manifests", "public", "size"),
        kvInt(d, "manifests", "public", "download"),
        kvInt(d, "maxsize"),
        kvObj(d, "encryptedmanifests") ? 1 : 0,
      );
    }
    for (const [name, b] of Object.entries(branches)) {
      insBranch.run(
        a.appid,
        name,
        kvInt(b, "buildid"),
        kvInt(b, "timeupdated"),
        kvStr(b, "description"),
        kvInt(b, "pwdrequired"),
      );
    }
    for (const [idx, l] of Object.entries(launch)) {
      insLaunch.run(
        a.appid,
        idx,
        kvStr(l, "executable"),
        kvStr(l, "arguments"),
        kvStr(l, "type"),
        kvStr(l, "config", "oslist"),
        kvStr(l, "config", "osarch"),
        kvStr(l, "description"),
        kvStr(l, "workingdir"),
      );
    }
  }
  db.run("COMMIT");
  return parsed.apps.length;
}

/** `developer`/`publisher` are either a string or an `associations` entry list. */
function firstAssoc(common: KvObject | null, role: string): string | null {
  const direct = kvStr(common, role);
  if (direct) return direct;
  const assoc = kvObj(common, "associations") ?? {};
  for (const v of Object.values(assoc)) if (kvStr(v, "type") === role) return kvStr(v, "name");
  return null;
}

/** Indexes `appcache/packageinfo.vdf` (PICS packages and their apps/depots). */
export async function readPackageInfo(db: Database, steamRoot: string): Promise<number> {
  const f = Bun.file(join(steamRoot, "appcache", "packageinfo.vdf"));
  if (!(await f.exists())) return 0;
  let parsed;
  try {
    parsed = parsePackageInfo(new Uint8Array(await f.arrayBuffer()));
  } catch {
    return 0;
  }
  const ins =
    db.query(`INSERT OR REPLACE INTO package(packageid, sha1, change_number, token, billingtype, licensetype, status, app_count, depot_count, kv_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insApp = db.query("INSERT OR REPLACE INTO package_app(packageid, appid) VALUES (?,?)");
  const insDepot = db.query("INSERT OR REPLACE INTO package_depot(packageid, depotid) VALUES (?,?)");
  db.run("BEGIN");
  for (const p of parsed.packages) {
    const root = kvObj(p.kv, String(p.packageid)) ?? p.kv;
    const appids = Object.values(kvObj(root, "appids") ?? {})
      .map(toInt)
      .filter((v): v is number => v !== null);
    const depotids = Object.values(kvObj(root, "depotids") ?? {})
      .map(toInt)
      .filter((v): v is number => v !== null);
    ins.run(
      p.packageid,
      p.sha1,
      p.changeNumber,
      p.token?.toString() ?? null,
      kvInt(root, "billingtype"),
      kvInt(root, "licensetype"),
      kvInt(root, "status"),
      appids.length,
      depotids.length,
      JSON.stringify(root),
    );
    for (const a of appids) insApp.run(p.packageid, a);
    for (const d of depotids) insDepot.run(p.packageid, d);
  }
  db.run("COMMIT");
  return parsed.packages.length;
}

async function readDepotManifests(db: Database, steamRoot: string): Promise<number> {
  const dir = join(steamRoot, "depotcache");
  if (!isDir(dir)) return 0;
  const insM =
    db.query(`INSERT OR REPLACE INTO depot_manifest(depotid, gid, path, bytes, creation_time, filenames_encrypted, cb_disk_original,
    cb_disk_compressed, unique_chunks, file_count, dir_count, chunk_count, signature_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insF =
    db.query(`INSERT OR REPLACE INTO depot_file(depotid, gid, filename, size, flags, sha_content, sha_filename, link_target, chunk_count)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let count = 0;
  db.run("BEGIN");
  for (const name of new Bun.Glob("*.manifest").scanSync({ cwd: dir })) {
    const m = name.match(/^(\d+)_(\d+)\.manifest$/);
    if (!m) continue;
    const path = join(dir, name);
    try {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      const man = parseDepotManifest(bytes);
      const depotid = man.metadata.depotId ?? Number(m[1]);
      const gid = man.metadata.gidManifest?.toString() ?? m[2]!;
      let dirs = 0;
      let chunks = 0;
      for (const f of man.files) {
        if (f.flags & FILE_FLAG_DIRECTORY) dirs++;
        chunks += f.chunkCount;
        insF.run(
          depotid,
          gid,
          f.filename,
          Number(f.size),
          f.flags,
          f.shaContent,
          f.shaFilename,
          f.linkTarget,
          f.chunkCount,
        );
      }
      insM.run(
        depotid,
        gid,
        norm(path),
        bytes.length,
        man.metadata.creationTime,
        man.metadata.filenamesEncrypted ? 1 : 0,
        toInt(man.metadata.cbDiskOriginal),
        toInt(man.metadata.cbDiskCompressed),
        man.metadata.uniqueChunks,
        man.files.length - dirs,
        dirs,
        chunks,
        man.signatureBytes,
      );
      count++;
    } catch {
      /* unreadable manifest */
    }
  }
  db.run("COMMIT");
  return count;
}

// ---------------------------------------------------------------------------------------------
// Logs

const LOG_LINE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s?(.*)$/;
const MAX_LOG_LINES = 400_000;

async function readLogs(db: Database, steamRoot: string): Promise<number> {
  const dir = join(steamRoot, "logs");
  if (!isDir(dir)) return 0;
  const ins = db.query("INSERT INTO log_event(log, ts, line, message) VALUES (?,?,?,?)");
  let total = 0;
  db.run("BEGIN");
  for (const name of new Bun.Glob("*.txt").scanSync({ cwd: dir })) {
    if (/login|connection|remote_connections/i.test(name)) continue; // account / network identifiers
    const text = await Bun.file(join(dir, name))
      .text()
      .catch(() => "");
    if (!text) continue;
    const log = basename(name, ".txt");
    let lineNo = 0;
    for (const line of text.split(/\r?\n/)) {
      lineNo++;
      if (!line) continue;
      const m = line.match(LOG_LINE);
      ins.run(log, m ? m[1]! : null, lineNo, m ? m[2]! : line);
      if (++total >= MAX_LOG_LINES) break;
    }
    if (total >= MAX_LOG_LINES) break;
  }
  db.run("INSERT INTO log_event_fts(log_event_fts) VALUES ('rebuild')");
  db.run("COMMIT");
  return total;
}

// ---------------------------------------------------------------------------------------------
// User data

async function readUserData(db: Database, steamRoot: string): Promise<number> {
  const dir = join(steamRoot, "userdata");
  if (!isDir(dir)) return 0;
  const insUser = db.query(
    "INSERT OR REPLACE INTO user(steamid3, steamid64, path, has_localconfig, app_count, cloud_app_count, byte_total) VALUES (?,?,?,?,?,?,?)",
  );
  const insAppUser = db.query(
    "INSERT OR REPLACE INTO app_user(steamid3, appid, last_played, playtime, playtime_disconnected, cloud_enabled) VALUES (?,?,?,?,?,?)",
  );
  const insCloudApp = db.query(
    "INSERT OR REPLACE INTO cloud_app(steamid3, appid, change_number, ostype, file_count, byte_total) VALUES (?,?,?,?,?,?)",
  );
  const insCloudFile =
    db.query(`INSERT OR REPLACE INTO cloud_file(steamid3, appid, root, path, size, sha, time, syncstate, persiststate, local_present, local_size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insCache = db.query(
    "INSERT OR REPLACE INTO librarycache(steamid3, appid, source, keys, bytes) VALUES (?,?,?,?,?)",
  );
  let users = 0;
  db.run("BEGIN");
  for (const idName of new Bun.Glob("*").scanSync({
    cwd: dir,
    onlyFiles: false,
  })) {
    if (!/^\d+$/.test(idName)) continue;
    const steamid3 = Number(idName);
    const userDir = join(dir, idName);
    if (!isDir(userDir)) continue;
    const steamid64 = (STEAMID64_BASE + BigInt(steamid3)).toString();
    const localconfig = join(userDir, "config", "localconfig.vdf");
    let appCount = 0;
    const lcText = readTextSync(localconfig);
    if (lcText) {
      const apps = kvObj(parseTextKv(lcText), "UserLocalConfigStore", "Software", "Valve", "Steam", "apps") ?? {};
      for (const [appid, a] of Object.entries(apps)) {
        if (!/^\d+$/.test(appid)) continue;
        insAppUser.run(
          steamid3,
          Number(appid),
          kvInt(a, "LastPlayed"),
          kvInt(a, "Playtime"),
          kvInt(a, "PlaytimeDisconnected"),
          kvObj(a, "cloud") ? (kvInt(a, "cloud", "last_sync_state") !== null ? 1 : null) : null,
        );
        appCount++;
      }
    }
    let cloudApps = 0;
    for (const appName of new Bun.Glob("*").scanSync({
      cwd: userDir,
      onlyFiles: false,
    })) {
      if (!/^\d+$/.test(appName)) continue;
      const appid = Number(appName);
      const rc = readTextSync(join(userDir, appName, "remotecache.vdf"));
      if (!rc) continue;
      const kv = kvObj(parseTextKv(rc), appName) ?? {};
      let fileCount = 0;
      let bytes = 0;
      for (const [path, entry] of Object.entries(kv)) {
        if (typeof entry === "string") continue;
        const local = join(userDir, appName, "remote", path);
        let localSize: number | null = null;
        try {
          localSize = statSync(local).size;
        } catch {
          /* not synced locally */
        }
        const size = kvInt(entry, "size");
        insCloudFile.run(
          steamid3,
          appid,
          kvStr(entry, "root"),
          norm(path),
          size,
          kvStr(entry, "sha"),
          kvInt(entry, "time"),
          kvInt(entry, "syncstate"),
          kvInt(entry, "persiststate"),
          localSize === null ? 0 : 1,
          localSize,
        );
        fileCount++;
        bytes += size ?? 0;
      }
      insCloudApp.run(steamid3, appid, kvStr(kv, "ChangeNumber"), kvInt(kv, "OSType"), fileCount, bytes);
      cloudApps++;
    }
    const cloudDir = join(userDir, "config", "cloudstorage");
    if (isDir(cloudDir)) {
      for (const name of new Bun.Glob("cloud-storage-namespace-*.json").scanSync({ cwd: cloudDir })) {
        const ns = name.match(/namespace-(\d+)(\.modified)?\.json$/);
        if (!ns) continue;
        const path = join(cloudDir, name);
        try {
          const data = (await Bun.file(path).json()) as unknown;
          const keys = Array.isArray(data) ? data.map(e => (Array.isArray(e) ? String(e[0]) : "")).filter(Boolean) : [];
          insCache.run(
            steamid3,
            0,
            `cloudstorage-ns-${ns[1]}${ns[2] ?? ""}`,
            JSON.stringify(keys),
            statSync(path).size,
          );
        } catch {
          /* malformed */
        }
      }
    }
    const lcDir = join(userDir, "config", "librarycache");
    if (isDir(lcDir)) {
      for (const name of new Bun.Glob("*.json").scanSync({ cwd: lcDir })) {
        const appid = Number(basename(name, ".json"));
        if (!Number.isFinite(appid)) continue;
        const path = join(lcDir, name);
        try {
          const data = (await Bun.file(path).json()) as unknown;
          const keys = Array.isArray(data)
            ? data.map(e => (Array.isArray(e) ? String(e[0]) : "")).filter(Boolean)
            : Object.keys(data as object);
          insCache.run(steamid3, appid, "user-librarycache", JSON.stringify(keys), statSync(path).size);
        } catch {
          /* malformed */
        }
      }
    }
    insUser.run(steamid3, steamid64, norm(userDir), lcText ? 1 : 0, appCount, cloudApps, dirBytes(userDir));
    users++;
  }
  db.run("COMMIT");
  return users;
}

function readLibraryCache(db: Database, steamRoot: string): void {
  const dir = join(steamRoot, "appcache", "librarycache");
  if (!isDir(dir)) return;
  const ins = db.query("INSERT OR REPLACE INTO librarycache(steamid3, appid, source, keys, bytes) VALUES (?,?,?,?,?)");
  db.run("BEGIN");
  for (const name of new Bun.Glob("*").scanSync({
    cwd: dir,
    onlyFiles: false,
  })) {
    if (!/^\d+$/.test(name)) continue;
    const appDir = join(dir, name);
    if (!isDir(appDir)) continue;
    const assets: string[] = [];
    let bytes = 0;
    for (const f of new Bun.Glob("*").scanSync({ cwd: appDir })) {
      assets.push(f);
      try {
        bytes += statSync(join(appDir, f)).size;
      } catch {
        /* vanished */
      }
    }
    ins.run(null, Number(name), "appcache", JSON.stringify(assets), bytes);
  }
  db.run("COMMIT");
}

// ---------------------------------------------------------------------------------------------
// Registry and processes (src/win.ts)

function readRegistry(db: Database): void {
  const insV = db.query("INSERT OR REPLACE INTO reg_value(hive, key, name, type, value) VALUES (?,?,?,?,?)");
  const insA = db.query("INSERT OR REPLACE INTO reg_app(appid, name, installed, updating, running) VALUES (?,?,?,?,?)");
  const record = (hive: string, key: string, whitelist: Set<string>) => {
    let listing: {
      keys?: string[];
      values?: { name: string; type: string; value: unknown }[];
    };
    try {
      listing = winRegistry.list(`${hive}\\${key}`) as typeof listing;
    } catch {
      return null;
    }
    for (const v of listing.values ?? []) {
      if (!whitelist.has(v.name)) continue;
      insV.run(hive, key, v.name, v.type, typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value));
    }
    return listing;
  };
  db.run("BEGIN");
  record("HKCU", HKCU_STEAM.slice(5), HKCU_WHITELIST);
  record("HKLM", HKLM_STEAM.slice(5), HKLM_WHITELIST);
  const apps = (() => {
    try {
      return winRegistry.list(`${HKCU_STEAM}\\Apps`) as { keys?: string[] };
    } catch {
      return { keys: [] as string[] };
    }
  })();
  for (const id of apps.keys ?? []) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const l = winRegistry.list(`${HKCU_STEAM}\\Apps\\${id}`) as {
        values?: { name: string; value: unknown }[];
      };
      const get = (n: string) => l.values?.find(v => v.name === n)?.value;
      insA.run(Number(id), str(get("Name")), toInt(get("Installed")), toInt(get("Updating")), toInt(get("Running")));
    } catch {
      /* key vanished */
    }
  }
  db.run("COMMIT");
}

function readProcesses(db: Database): void {
  let list: { pid: number; ppid?: number; name?: string; path?: string }[];
  try {
    list = winProcesses.list({ detail: true }) as typeof list;
  } catch {
    return;
  }
  const ins = db.query("INSERT OR REPLACE INTO process(pid, ppid, name, path) VALUES (?,?,?,?)");
  db.run("BEGIN");
  for (const p of list) {
    if (!p.name || !/steam|gameoverlayui|easyanticheat|dbxv2|xenoverse/i.test(p.name)) continue;
    ins.run(p.pid, p.ppid ?? null, p.name, p.path ?? null);
  }
  db.run("COMMIT");
}

// ---------------------------------------------------------------------------------------------

function readTextSync(path: string): string | null {
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  try {
    return new TextDecoder("utf-8").decode(readFileSync(path));
  } catch {
    return null;
  }
}
