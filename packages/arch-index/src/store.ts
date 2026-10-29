// SPDX-License-Identifier: MIT
// SQLite store (bun:sqlite) of the Arch + AUR index. One file holds everything; snapshots use their own file.
import { Database, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DbPackage } from "./desc.ts";
import { parseDep } from "./version.ts";

export const SCHEMA_VERSION = 1;

export type DepKind = "depends" | "makedepends" | "checkdepends" | "optdepends" | "provides" | "conflicts" | "replaces";
export const DEP_KINDS: DepKind[] = [
  "depends",
  "makedepends",
  "checkdepends",
  "optdepends",
  "provides",
  "conflicts",
  "replaces",
];

/** Normalised package row, shared by official repositories and the AUR. */
export interface PackageRow {
  id: number;
  source: "repo" | "aur";
  repo: string;
  name: string;
  base: string;
  version: string;
  description: string;
  url: string;
  arch: string;
  filename: string;
  csize: number;
  isize: number;
  sha256: string;
  builddate: number;
  packager: string;
  licenses: string[];
  groups: string[];
  aurId: number | null;
  votes: number | null;
  popularity: number | null;
  outOfDate: number | null;
  maintainer: string | null;
  submitter: string | null;
  firstSubmitted: number | null;
  lastModified: number | null;
  comaintainers: string[];
  keywords: string[];
}

/** One AUR record as published in packages-meta-ext-v1.json and RPC v5 `info`. */
export interface AurRecord {
  ID: number;
  Name: string;
  PackageBaseID: number;
  PackageBase: string;
  Version: string;
  Description?: string | null;
  URL?: string | null;
  NumVotes: number;
  Popularity: number;
  OutOfDate: number | null;
  Maintainer: string | null;
  Submitter?: string | null;
  FirstSubmitted: number;
  LastModified: number;
  URLPath?: string;
  Depends?: string[];
  MakeDepends?: string[];
  CheckDepends?: string[];
  OptDepends?: string[];
  Provides?: string[];
  Conflicts?: string[];
  Replaces?: string[];
  License?: string[];
  Keywords?: string[];
  Groups?: string[];
  CoMaintainers?: string[];
}

export interface IndexEvent {
  id: number;
  ts: number;
  type: string;
  source: string;
  repo: string;
  name: string;
  old: string | null;
  new: string | null;
  data: unknown;
}

export interface ReplaceResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  total: number;
  initial: boolean;
}

export interface FetchState {
  url: string;
  etag: string | null;
  lastModified: string | null;
  checkedAt: number;
  changedAt: number;
  bytes: number;
  sha256: string | null;
}

/** ~/.cache/bunos/arch, overridable with BUNOS_ARCH_CACHE. */
export function defaultCacheDir(env: Record<string, string | undefined> = process.env): string {
  return env.BUNOS_ARCH_CACHE ?? join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "bunos", "arch");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fetch_state(
  url TEXT PRIMARY KEY, etag TEXT, last_modified TEXT, checked_at INTEGER NOT NULL, changed_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT);
CREATE TABLE IF NOT EXISTS packages(
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, repo TEXT NOT NULL, name TEXT NOT NULL, base TEXT NOT NULL,
  version TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', arch TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '', csize INTEGER NOT NULL DEFAULT 0, isize INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '', builddate INTEGER NOT NULL DEFAULT 0, packager TEXT NOT NULL DEFAULT '',
  licenses TEXT NOT NULL DEFAULT '[]', groups TEXT NOT NULL DEFAULT '[]',
  aur_id INTEGER, votes INTEGER, popularity REAL, out_of_date INTEGER, maintainer TEXT, submitter TEXT,
  first_submitted INTEGER, last_modified INTEGER, comaintainers TEXT NOT NULL DEFAULT '[]', keywords TEXT NOT NULL DEFAULT '[]',
  UNIQUE(repo, name, arch));
CREATE INDEX IF NOT EXISTS packages_name ON packages(name);
CREATE INDEX IF NOT EXISTS packages_base ON packages(base);
CREATE INDEX IF NOT EXISTS packages_source ON packages(source, repo);
CREATE TABLE IF NOT EXISTS deps(pkg_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, op TEXT NOT NULL DEFAULT '', ver TEXT NOT NULL DEFAULT '', descr TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS deps_pkg ON deps(pkg_id);
CREATE INDEX IF NOT EXISTS deps_name ON deps(kind, name);
CREATE TABLE IF NOT EXISTS files(pkg_id INTEGER NOT NULL, path TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS files_pkg ON files(pkg_id);
CREATE TABLE IF NOT EXISTS blobs(sha256 TEXT PRIMARY KEY, kind TEXT NOT NULL, size INTEGER NOT NULL, z BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS srcinfo(
  source TEXT NOT NULL, pkgbase TEXT NOT NULL, version TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '',
  srcinfo_sha256 TEXT, pkgbuild_sha256 TEXT, fetched_at INTEGER NOT NULL,
  PRIMARY KEY(source, pkgbase, version));
CREATE INDEX IF NOT EXISTS srcinfo_base ON srcinfo(pkgbase);
CREATE TABLE IF NOT EXISTS source_entries(
  source TEXT NOT NULL, pkgbase TEXT NOT NULL, version TEXT NOT NULL, idx INTEGER NOT NULL,
  entry TEXT NOT NULL, arch TEXT NOT NULL DEFAULT '', algo TEXT NOT NULL DEFAULT '', checksum TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS source_entries_pk ON source_entries(source, pkgbase, version);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL,
  repo TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', old TEXT, new TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_name ON events(name);
CREATE TABLE IF NOT EXISTS news(guid TEXT PRIMARY KEY, title TEXT NOT NULL, link TEXT NOT NULL, published INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS rpc_budget(day TEXT PRIMARY KEY, requests INTEGER NOT NULL);
`;

const PKG_COLS = `id, source, repo, name, base, version, description, url, arch, filename, csize, isize, sha256, builddate,
  packager, licenses, groups, aur_id AS aurId, votes, popularity, out_of_date AS outOfDate, maintainer, submitter,
  first_submitted AS firstSubmitted, last_modified AS lastModified, comaintainers, keywords`;

function hydrate(row: Record<string, unknown>): PackageRow {
  const r = row as unknown as PackageRow & {
    licenses: string;
    groups: string;
    comaintainers: string;
    keywords: string;
  };
  return {
    ...r,
    licenses: JSON.parse(r.licenses),
    groups: JSON.parse(r.groups),
    comaintainers: JSON.parse(r.comaintainers),
    keywords: JSON.parse(r.keywords),
  };
}

export class Store {
  readonly db: Database;
  private readonly cache = new Map<string, Statement>();

  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");
    this.db.run("PRAGMA foreign_keys = OFF");
    this.db.exec(SCHEMA);
    const version = this.getMeta("schema_version");
    if (version === null) this.setMeta("schema_version", String(SCHEMA_VERSION));
    else if (Number(version) !== SCHEMA_VERSION)
      throw new Error(
        `Index schema ${version} at ${path} is not supported (expected ${SCHEMA_VERSION}); delete the file and sync again.`,
      );
  }

  close(): void {
    this.cache.clear();
    this.db.close();
  }

  private stmt(sql: string): Statement {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.query(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  getMeta(key: string): string | null {
    return (this.stmt("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.stmt("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      key,
      value,
    );
  }

  getFetchState(url: string): FetchState | null {
    const r = this.stmt(
      "SELECT url, etag, last_modified AS lastModified, checked_at AS checkedAt, changed_at AS changedAt, bytes, sha256 FROM fetch_state WHERE url = ?",
    ).get(url) as FetchState | null;
    return r;
  }

  /** Record a conditional-request outcome; `changed` is false for a 304. */
  setFetchState(
    url: string,
    s: { etag?: string | null; lastModified?: string | null; bytes?: number; sha256?: string | null },
    changed: boolean,
    now = Date.now(),
  ): void {
    const prev = this.getFetchState(url);
    this.stmt(
      `INSERT INTO fetch_state(url, etag, last_modified, checked_at, changed_at, bytes, sha256) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(url) DO UPDATE SET etag=excluded.etag, last_modified=excluded.last_modified, checked_at=excluded.checked_at,
         changed_at=excluded.changed_at, bytes=excluded.bytes, sha256=excluded.sha256`,
    ).run(
      url,
      changed ? (s.etag ?? null) : (prev?.etag ?? null),
      changed ? (s.lastModified ?? null) : (prev?.lastModified ?? null),
      now,
      changed ? now : (prev?.changedAt ?? now),
      changed ? (s.bytes ?? 0) : (prev?.bytes ?? 0),
      changed ? (s.sha256 ?? null) : (prev?.sha256 ?? null),
    );
  }

  addEvent(e: {
    type: string;
    source: string;
    repo?: string;
    name?: string;
    old?: string | null;
    new?: string | null;
    data?: unknown;
    ts?: number;
  }): IndexEvent {
    const ts = e.ts ?? Date.now();
    const res = this.stmt(
      "INSERT INTO events(ts, type, source, repo, name, old, new, data) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      ts,
      e.type,
      e.source,
      e.repo ?? "",
      e.name ?? "",
      e.old ?? null,
      e.new ?? null,
      e.data === undefined ? null : JSON.stringify(e.data),
    );
    return {
      id: Number(res.lastInsertRowid),
      ts,
      type: e.type,
      source: e.source,
      repo: e.repo ?? "",
      name: e.name ?? "",
      old: e.old ?? null,
      new: e.new ?? null,
      data: e.data ?? null,
    };
  }

  listEvents(
    options: { sinceId?: number; sinceTs?: number; type?: string; name?: string; limit?: number } = {},
  ): IndexEvent[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (options.sinceId !== undefined) (where.push("id > ?"), args.push(options.sinceId));
    if (options.sinceTs !== undefined) (where.push("ts >= ?"), args.push(options.sinceTs));
    if (options.type) (where.push("type = ?"), args.push(options.type));
    if (options.name) (where.push("name = ?"), args.push(options.name));
    const sql = `SELECT id, ts, type, source, repo, name, old, new, data FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id ${options.sinceId !== undefined ? "ASC" : "DESC"} LIMIT ?`;
    const rows = this.db.query(sql).all(...args, options.limit ?? 200) as (Omit<IndexEvent, "data"> & {
      data: string | null;
    })[];
    return rows.map(r => ({ ...r, data: r.data === null ? null : JSON.parse(r.data) }));
  }

  /** Store a file content-addressed (zstd) and return its sha256. */
  putBlob(kind: string, content: Uint8Array | string): string {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const exists = this.stmt("SELECT 1 FROM blobs WHERE sha256 = ?").get(sha256);
    if (!exists)
      this.stmt("INSERT INTO blobs(sha256, kind, size, z) VALUES(?,?,?,?)").run(
        sha256,
        kind,
        bytes.length,
        Bun.zstdCompressSync(bytes, { level: 6 }),
      );
    return sha256;
  }

  getBlob(sha256: string): string | null {
    const r = this.stmt("SELECT z FROM blobs WHERE sha256 = ?").get(sha256) as { z: Uint8Array } | null;
    return r ? new TextDecoder().decode(Bun.zstdDecompressSync(r.z)) : null;
  }

  // ---- packages -------------------------------------------------------------------------------------------------

  getPackages(name: string): PackageRow[] {
    return (
      this.stmt(`SELECT ${PKG_COLS} FROM packages WHERE name = ? ORDER BY source, repo`).all(name) as Record<
        string,
        unknown
      >[]
    ).map(hydrate);
  }

  getPackage(
    name: string,
    options: { source?: "repo" | "aur"; repo?: string; testing?: boolean } = {},
  ): PackageRow | null {
    const rows = this.getPackages(name).filter(
      p =>
        (!options.source || p.source === options.source) &&
        (!options.repo || p.repo === options.repo) &&
        (options.testing || options.repo || !isTestingRepo(p.repo)),
    );
    return rows[0] ?? null;
  }

  packagesByBase(base: string): PackageRow[] {
    return (
      this.stmt(`SELECT ${PKG_COLS} FROM packages WHERE base = ? ORDER BY source, repo, name`).all(base) as Record<
        string,
        unknown
      >[]
    ).map(hydrate);
  }

  depsOf(pkgId: number, kind?: DepKind): { kind: DepKind; name: string; op: string; ver: string; descr: string }[] {
    const rows = kind
      ? this.stmt("SELECT kind, name, op, ver, descr FROM deps WHERE pkg_id = ? AND kind = ? ORDER BY rowid").all(
          pkgId,
          kind,
        )
      : this.stmt("SELECT kind, name, op, ver, descr FROM deps WHERE pkg_id = ? ORDER BY rowid").all(pkgId);
    return rows as { kind: DepKind; name: string; op: string; ver: string; descr: string }[];
  }

  filesOf(pkgId: number): string[] {
    return (this.stmt("SELECT path FROM files WHERE pkg_id = ? ORDER BY path").all(pkgId) as { path: string }[]).map(
      r => r.path,
    );
  }

  count(source?: "repo" | "aur", repo?: string): number {
    if (repo) return (this.stmt("SELECT COUNT(*) AS n FROM packages WHERE repo = ?").get(repo) as { n: number }).n;
    if (source)
      return (this.stmt("SELECT COUNT(*) AS n FROM packages WHERE source = ?").get(source) as { n: number }).n;
    return (this.stmt("SELECT COUNT(*) AS n FROM packages").get() as { n: number }).n;
  }

  repoCounts(): { source: string; repo: string; n: number; latestBuild: number }[] {
    return this.db
      .query(
        "SELECT source, repo, COUNT(*) AS n, MAX(builddate) AS latestBuild FROM packages GROUP BY source, repo ORDER BY source, repo",
      )
      .all() as {
      source: string;
      repo: string;
      n: number;
      latestBuild: number;
    }[];
  }

  private insertDeps(id: number, kind: DepKind, values: readonly string[] | undefined): void {
    if (!values?.length) return;
    const ins = this.stmt("INSERT INTO deps(pkg_id, kind, name, op, ver, descr) VALUES(?,?,?,?,?,?)");
    for (const raw of values) {
      const d = parseDep(raw);
      ins.run(id, kind, d.name, d.op, d.version, d.description);
    }
  }

  /**
   * Replace one official repository with the parsed database content. Only changed packages are rewritten and
   * every change becomes an event. An empty repository yields one `initial` event instead of one per package.
   */
  replaceRepo(
    repo: string,
    packages: DbPackage[],
    options: { files?: boolean; now?: number; emit?: (e: IndexEvent) => void } = {},
  ): ReplaceResult {
    const now = options.now ?? Date.now();
    const result: ReplaceResult = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      total: packages.length,
      initial: false,
    };
    const events: IndexEvent[] = [];
    const tx = this.db.transaction(() => {
      const existing = new Map<string, { id: number; version: string; builddate: number }>();
      for (const r of this.stmt("SELECT id, name, arch, version, builddate FROM packages WHERE repo = ?").all(repo) as {
        id: number;
        name: string;
        arch: string;
        version: string;
        builddate: number;
      }[])
        existing.set(`${r.name}\0${r.arch}`, r);
      result.initial = existing.size === 0;
      const seen = new Set<string>();
      for (const p of packages) {
        const key = `${p.name}\0${p.arch}`;
        seen.add(key);
        const old = existing.get(key);
        if (old && old.version === p.version && old.builddate === p.builddate) {
          result.unchanged++;
          if (options.files && p.files.length) this.replaceFiles(old.id, p.files);
          continue;
        }
        let id: number;
        if (old) {
          id = old.id;
          this.stmt("DELETE FROM deps WHERE pkg_id = ?").run(id);
          this.stmt("DELETE FROM files WHERE pkg_id = ?").run(id);
          this.stmt(
            `UPDATE packages SET base=?, version=?, description=?, url=?, filename=?, csize=?, isize=?, sha256=?, builddate=?, packager=?, licenses=?, groups=? WHERE id=?`,
          ).run(
            p.base,
            p.version,
            p.description,
            p.url,
            p.filename,
            p.csize,
            p.isize,
            p.sha256,
            p.builddate,
            p.packager,
            JSON.stringify(p.licenses),
            JSON.stringify(p.groups),
            id,
          );
          result.updated++;
          if (!result.initial)
            events.push(
              this.addEvent({
                type: "updated",
                source: "repo",
                repo,
                name: p.name,
                old: old.version,
                new: p.version,
                ts: now,
              }),
            );
        } else {
          const res = this.stmt(
            `INSERT INTO packages(source, repo, name, base, version, description, url, arch, filename, csize, isize, sha256, builddate, packager, licenses, groups)
             VALUES('repo',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            repo,
            p.name,
            p.base,
            p.version,
            p.description,
            p.url,
            p.arch,
            p.filename,
            p.csize,
            p.isize,
            p.sha256,
            p.builddate,
            p.packager,
            JSON.stringify(p.licenses),
            JSON.stringify(p.groups),
          );
          id = Number(res.lastInsertRowid);
          result.added++;
          if (!result.initial)
            events.push(this.addEvent({ type: "added", source: "repo", repo, name: p.name, new: p.version, ts: now }));
        }
        for (const kind of DEP_KINDS) this.insertDeps(id, kind, p[kind]);
        if (options.files && p.files.length) this.replaceFiles(id, p.files);
      }
      for (const [key, old] of existing) {
        if (seen.has(key)) continue;
        const name = key.split("\0")[0]!;
        this.stmt("DELETE FROM deps WHERE pkg_id = ?").run(old.id);
        this.stmt("DELETE FROM files WHERE pkg_id = ?").run(old.id);
        this.stmt("DELETE FROM packages WHERE id = ?").run(old.id);
        result.removed++;
        events.push(this.addEvent({ type: "removed", source: "repo", repo, name, old: old.version, ts: now }));
      }
      if (result.initial)
        events.push(this.addEvent({ type: "initial", source: "repo", repo, new: String(packages.length), ts: now }));
    });
    tx();
    for (const e of events) options.emit?.(e);
    return result;
  }

  private replaceFiles(id: number, files: string[]): void {
    this.stmt("DELETE FROM files WHERE pkg_id = ?").run(id);
    const ins = this.stmt("INSERT INTO files(pkg_id, path) VALUES(?,?)");
    for (const f of files) ins.run(id, f);
  }

  /** Replace the whole AUR table content from the metadata archive (or a partial RPC answer with `partial`). */
  replaceAur(
    records: AurRecord[],
    options: { partial?: boolean; now?: number; emit?: (e: IndexEvent) => void } = {},
  ): ReplaceResult {
    const now = options.now ?? Date.now();
    const result: ReplaceResult = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      total: records.length,
      initial: false,
    };
    const events: IndexEvent[] = [];
    const tx = this.db.transaction(() => {
      const existing = new Map<
        string,
        { id: number; version: string; lastModified: number; outOfDate: number | null; maintainer: string | null }
      >();
      for (const r of this.stmt(
        "SELECT id, name, version, last_modified AS lastModified, out_of_date AS outOfDate, maintainer FROM packages WHERE repo = 'aur'",
      ).all() as {
        id: number;
        name: string;
        version: string;
        lastModified: number;
        outOfDate: number | null;
        maintainer: string | null;
      }[])
        existing.set(r.name, r);
      result.initial = existing.size === 0;
      const seen = new Set<string>();
      for (const a of records) {
        seen.add(a.Name);
        const old = existing.get(a.Name);
        const meta = [
          JSON.stringify(a.License ?? []),
          JSON.stringify(a.Groups ?? []),
          JSON.stringify(a.CoMaintainers ?? []),
          JSON.stringify(a.Keywords ?? []),
        ] as const;
        let id: number;
        if (old) {
          id = old.id;
          const depsChanged = old.version !== a.Version || old.lastModified !== a.LastModified;
          this.stmt(
            `UPDATE packages SET base=?, version=?, description=?, url=?, aur_id=?, votes=?, popularity=?, out_of_date=?, maintainer=?, submitter=?,
               first_submitted=?, last_modified=?, licenses=?, groups=?, comaintainers=?, keywords=?, filename=? WHERE id=?`,
          ).run(
            a.PackageBase,
            a.Version,
            a.Description ?? "",
            a.URL ?? "",
            a.ID,
            a.NumVotes,
            a.Popularity,
            a.OutOfDate,
            a.Maintainer,
            a.Submitter ?? null,
            a.FirstSubmitted,
            a.LastModified,
            meta[0],
            meta[1],
            meta[2],
            meta[3],
            a.URLPath ?? "",
            id,
          );
          if (!depsChanged && old.outOfDate === a.OutOfDate && old.maintainer === a.Maintainer) {
            result.unchanged++;
            continue;
          }
          if (depsChanged) {
            this.stmt("DELETE FROM deps WHERE pkg_id = ?").run(id);
          }
          result.updated++;
          if (!result.initial) {
            if (old.version !== a.Version)
              events.push(
                this.addEvent({
                  type: "updated",
                  source: "aur",
                  repo: "aur",
                  name: a.Name,
                  old: old.version,
                  new: a.Version,
                  ts: now,
                }),
              );
            if (old.outOfDate === null && a.OutOfDate !== null)
              events.push(
                this.addEvent({
                  type: "flagged-out-of-date",
                  source: "aur",
                  repo: "aur",
                  name: a.Name,
                  old: null,
                  new: String(a.OutOfDate),
                  ts: now,
                }),
              );
            if (old.outOfDate !== null && a.OutOfDate === null)
              events.push(
                this.addEvent({
                  type: "unflagged",
                  source: "aur",
                  repo: "aur",
                  name: a.Name,
                  old: String(old.outOfDate),
                  new: null,
                  ts: now,
                }),
              );
            if (old.maintainer !== null && a.Maintainer === null)
              events.push(
                this.addEvent({
                  type: "orphaned",
                  source: "aur",
                  repo: "aur",
                  name: a.Name,
                  old: old.maintainer,
                  new: null,
                  ts: now,
                }),
              );
            else if (old.maintainer === null && a.Maintainer !== null)
              events.push(
                this.addEvent({
                  type: "adopted",
                  source: "aur",
                  repo: "aur",
                  name: a.Name,
                  old: null,
                  new: a.Maintainer,
                  ts: now,
                }),
              );
            else if (old.maintainer !== a.Maintainer)
              events.push(
                this.addEvent({
                  type: "maintainer-changed",
                  source: "aur",
                  repo: "aur",
                  name: a.Name,
                  old: old.maintainer,
                  new: a.Maintainer,
                  ts: now,
                }),
              );
          }
          if (!depsChanged) continue;
        } else {
          const res = this.stmt(
            `INSERT INTO packages(source, repo, name, base, version, description, url, arch, filename, aur_id, votes, popularity, out_of_date, maintainer, submitter,
               first_submitted, last_modified, licenses, groups, comaintainers, keywords)
             VALUES('aur','aur',?,?,?,?,?,'',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            a.Name,
            a.PackageBase,
            a.Version,
            a.Description ?? "",
            a.URL ?? "",
            a.URLPath ?? "",
            a.ID,
            a.NumVotes,
            a.Popularity,
            a.OutOfDate,
            a.Maintainer,
            a.Submitter ?? null,
            a.FirstSubmitted,
            a.LastModified,
            meta[0],
            meta[1],
            meta[2],
            meta[3],
          );
          id = Number(res.lastInsertRowid);
          result.added++;
          if (!result.initial)
            events.push(
              this.addEvent({ type: "added", source: "aur", repo: "aur", name: a.Name, new: a.Version, ts: now }),
            );
        }
        this.insertDeps(id, "depends", a.Depends);
        this.insertDeps(id, "makedepends", a.MakeDepends);
        this.insertDeps(id, "checkdepends", a.CheckDepends);
        this.insertDeps(id, "optdepends", a.OptDepends);
        this.insertDeps(id, "provides", a.Provides);
        this.insertDeps(id, "conflicts", a.Conflicts);
        this.insertDeps(id, "replaces", a.Replaces);
      }
      if (!options.partial) {
        for (const [name, old] of existing) {
          if (seen.has(name)) continue;
          this.stmt("DELETE FROM deps WHERE pkg_id = ?").run(old.id);
          this.stmt("DELETE FROM packages WHERE id = ?").run(old.id);
          result.removed++;
          events.push(this.addEvent({ type: "removed", source: "aur", repo: "aur", name, old: old.version, ts: now }));
        }
      }
      if (result.initial && !options.partial)
        events.push(
          this.addEvent({ type: "initial", source: "aur", repo: "aur", new: String(records.length), ts: now }),
        );
    });
    tx();
    for (const e of events) options.emit?.(e);
    return result;
  }

  // ---- sources --------------------------------------------------------------------------------------------------

  hasSrcinfo(source: string, pkgbase: string, version: string): boolean {
    return !!this.stmt("SELECT 1 FROM srcinfo WHERE source = ? AND pkgbase = ? AND version = ?").get(
      source,
      pkgbase,
      version,
    );
  }

  getSrcinfoRow(
    source: string,
    pkgbase: string,
    version?: string,
  ): {
    source: string;
    pkgbase: string;
    version: string;
    ref: string;
    srcinfo_sha256: string | null;
    pkgbuild_sha256: string | null;
    fetched_at: number;
  } | null {
    const sql = version
      ? "SELECT * FROM srcinfo WHERE source = ? AND pkgbase = ? AND version = ?"
      : "SELECT * FROM srcinfo WHERE source = ? AND pkgbase = ? ORDER BY fetched_at DESC LIMIT 1";
    return (version ? this.stmt(sql).get(source, pkgbase, version) : this.stmt(sql).get(source, pkgbase)) as never;
  }

  listSrcinfoVersions(
    source: string,
    pkgbase: string,
  ): {
    version: string;
    ref: string;
    srcinfo_sha256: string | null;
    pkgbuild_sha256: string | null;
    fetched_at: number;
  }[] {
    return this.stmt(
      "SELECT version, ref, srcinfo_sha256, pkgbuild_sha256, fetched_at FROM srcinfo WHERE source = ? AND pkgbase = ? ORDER BY fetched_at",
    ).all(source, pkgbase) as never;
  }

  putSources(
    source: string,
    pkgbase: string,
    version: string,
    ref: string,
    parts: {
      srcinfo?: string;
      pkgbuild?: string;
      entries?: { source: string; arch: string; checksums: Record<string, string> }[];
    },
    now = Date.now(),
  ): void {
    this.db.transaction(() => {
      const si = parts.srcinfo === undefined ? null : this.putBlob("srcinfo", parts.srcinfo);
      const pb = parts.pkgbuild === undefined ? null : this.putBlob("pkgbuild", parts.pkgbuild);
      this.stmt(
        `INSERT INTO srcinfo(source, pkgbase, version, ref, srcinfo_sha256, pkgbuild_sha256, fetched_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(source, pkgbase, version) DO UPDATE SET ref=excluded.ref, srcinfo_sha256=COALESCE(excluded.srcinfo_sha256, srcinfo_sha256),
           pkgbuild_sha256=COALESCE(excluded.pkgbuild_sha256, pkgbuild_sha256), fetched_at=excluded.fetched_at`,
      ).run(source, pkgbase, version, ref, si, pb, now);
      if (parts.entries) {
        this.stmt("DELETE FROM source_entries WHERE source = ? AND pkgbase = ? AND version = ?").run(
          source,
          pkgbase,
          version,
        );
        const ins = this.stmt(
          "INSERT INTO source_entries(source, pkgbase, version, idx, entry, arch, algo, checksum) VALUES(?,?,?,?,?,?,?,?)",
        );
        parts.entries.forEach((e, i) => {
          const algos = Object.keys(e.checksums);
          if (algos.length === 0) ins.run(source, pkgbase, version, i, e.source, e.arch, "", "");
          for (const algo of algos) ins.run(source, pkgbase, version, i, e.source, e.arch, algo, e.checksums[algo]!);
        });
      }
    })();
  }

  sourceEntries(
    source: string,
    pkgbase: string,
    version: string,
  ): { idx: number; entry: string; arch: string; algo: string; checksum: string }[] {
    return this.stmt(
      "SELECT idx, entry, arch, algo, checksum FROM source_entries WHERE source = ? AND pkgbase = ? AND version = ? ORDER BY idx, algo",
    ).all(source, pkgbase, version) as never;
  }

  // ---- news, budget ---------------------------------------------------------------------------------------------

  upsertNews(items: { guid: string; title: string; link: string; published: number; summary: string }[]): typeof items {
    const fresh: typeof items = [];
    this.db.transaction(() => {
      for (const n of items) {
        const had = this.stmt("SELECT 1 FROM news WHERE guid = ?").get(n.guid);
        if (!had) {
          fresh.push(n);
          this.stmt("INSERT INTO news(guid, title, link, published, summary) VALUES(?,?,?,?,?)").run(
            n.guid,
            n.title,
            n.link,
            n.published,
            n.summary,
          );
        }
      }
    })();
    return fresh;
  }

  /** AUR RPC budget bookkeeping: 4000 requests per day per IP. */
  rpcUsed(day = new Date().toISOString().slice(0, 10)): number {
    return (
      (this.stmt("SELECT requests FROM rpc_budget WHERE day = ?").get(day) as { requests: number } | null)?.requests ??
      0
    );
  }

  rpcCount(n = 1, day = new Date().toISOString().slice(0, 10)): void {
    this.stmt(
      "INSERT INTO rpc_budget(day, requests) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET requests = requests + excluded.requests",
    ).run(day, n);
  }
}

export function isTestingRepo(repo: string): boolean {
  return /-(testing|staging)$/.test(repo) || repo === "testing" || repo === "staging";
}

export function openStore(path?: string): Store {
  return new Store(path ?? join(defaultCacheDir(), "index.sqlite"));
}
