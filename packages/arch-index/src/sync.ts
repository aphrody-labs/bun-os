// SPDX-License-Identifier: MIT
// Synchronisation of the index with Arch infrastructure. Every network call goes through ArchClient
// (User-Agent, conditional requests, spacing, Retry-After); bulk dumps are preferred over per-package scraping.
import { parseDb } from "./desc.ts";
import { parseRss, parsePackageFeedTitle } from "./feeds.ts";
import { ArchClient, HttpError } from "./http.ts";
import { EventBus } from "./events.ts";
import { parseSrcinfo } from "./srcinfo.ts";
import { Store, type AurRecord, type IndexEvent } from "./store.ts";
import { vercmp } from "./version.ts";

export const DEFAULT_REPOS = ["core", "extra", "multilib"] as const;
export const TESTING_REPOS = ["core-testing", "extra-testing", "multilib-testing"] as const;
export const STAGING_REPOS = ["core-staging", "extra-staging", "multilib-staging"] as const;

export interface Endpoints {
  /** Mirror roots with $repo/os/$arch layout beneath, tried in order. */
  mirrors: string[];
  arch: string;
  aurMeta: string;
  aurRpc: string;
  aurCgit: string;
  gitlabRaw: string;
  archive: string;
  archlinuxOrg: string;
  wslIndex: string;
}

export const DEFAULT_ENDPOINTS: Endpoints = {
  mirrors: ["https://geo.mirror.pkgbuild.com", "https://mirrors.kernel.org/archlinux"],
  arch: "x86_64",
  aurMeta: "https://aur.archlinux.org/packages-meta-ext-v1.json.gz",
  aurRpc: "https://aur.archlinux.org/rpc/v5",
  aurCgit: "https://aur.archlinux.org/cgit/aur.git/plain",
  gitlabRaw: "https://gitlab.archlinux.org/archlinux/packaging/packages",
  archive: "https://archive.archlinux.org/repos",
  archlinuxOrg: "https://archlinux.org",
  wslIndex: "https://fastly.mirror.pkgbuild.com/wsl",
};

/** AUR documents a limit of 4000 RPC requests per day and IP; stay below it. */
export const AUR_RPC_DAILY_CAP = 3800;
/** packages-meta-ext-v1.json.gz is served with Cache-Control: max-age=300. */
export const AUR_META_MIN_INTERVAL_MS = 300_000;

export interface Context {
  store: Store;
  client: ArchClient;
  bus: EventBus;
  endpoints: Endpoints;
  now: () => number;
}

export function createContext(options: { store: Store; client?: ArchClient; bus?: EventBus; endpoints?: Partial<Endpoints>; now?: () => number }): Context {
  return {
    store: options.store,
    client:
      options.client ??
      new ArchClient({ hostIntervalMs: { "gitlab.archlinux.org": 500, "aur.archlinux.org": 1000, "archlinux.org": 1000 } }),
    bus: options.bus ?? new EventBus(),
    endpoints: { ...DEFAULT_ENDPOINTS, ...options.endpoints },
    now: options.now ?? Date.now,
  };
}

const emitter = (ctx: Context) => (e: IndexEvent) => ctx.bus.emit(e);

function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

// ---- official repositories ------------------------------------------------------------------------------------------

export interface RepoSyncReport {
  repo: string;
  status: "updated" | "not-modified" | "error";
  packages?: number;
  added?: number;
  updated?: number;
  removed?: number;
  bytes?: number;
  ms: number;
  mirror?: string;
  error?: string;
}

function dbUrl(mirror: string, repo: string, arch: string, files: boolean): string {
  return `${mirror}/${repo}/os/${arch}/${repo}.${files ? "files" : "db"}`;
}

/** Refuse to replace a populated repository with a suspiciously small database (truncated mirror). */
function assertNotShrunk(kind: string, previous: number, next: number, force?: boolean): void {
  if (!force && previous >= 100 && next < previous * 0.5)
    throw new Error(`${kind}: refusing to replace ${previous} entries by ${next} (mirror looks truncated); rerun with force to accept.`);
}

export async function syncRepo(ctx: Context, repo: string, options: { files?: boolean; force?: boolean; dbBase?: string } = {}): Promise<RepoSyncReport> {
  const started = performance.now();
  const mirrors = options.dbBase ? [options.dbBase] : ctx.endpoints.mirrors;
  let lastError: unknown;
  for (const mirror of mirrors) {
    const url = dbUrl(mirror, repo, ctx.endpoints.arch, !!options.files);
    try {
      const state = options.force ? undefined : (ctx.store.getFetchState(url) ?? undefined);
      const out = await ctx.client.get(url, { state: state ? { etag: state.etag, lastModified: state.lastModified } : undefined });
      if (out.kind === "not-modified") {
        ctx.store.setFetchState(url, {}, false, ctx.now());
        return { repo, status: "not-modified", ms: performance.now() - started, mirror };
      }
      const packages = parseDb(out.body, { repo, files: options.files });
      assertNotShrunk(`${repo}.${options.files ? "files" : "db"}`, ctx.store.count(undefined, repo), packages.length, options.force);
      const result = ctx.store.replaceRepo(repo, packages, { files: options.files, now: ctx.now(), emit: emitter(ctx) });
      ctx.store.setFetchState(url, { etag: out.etag, lastModified: out.lastModified, bytes: out.body.length, sha256: sha256Hex(out.body) }, true, ctx.now());
      return { repo, status: "updated", packages: packages.length, added: result.added, updated: result.updated, removed: result.removed, bytes: out.body.length, ms: performance.now() - started, mirror };
    } catch (error) {
      lastError = error;
    }
  }
  return { repo, status: "error", ms: performance.now() - started, error: lastError instanceof Error ? lastError.message : String(lastError) };
}

export async function syncOfficial(ctx: Context, options: { repos?: readonly string[]; files?: boolean; force?: boolean } = {}): Promise<RepoSyncReport[]> {
  const reports: RepoSyncReport[] = [];
  for (const repo of options.repos ?? DEFAULT_REPOS) reports.push(await syncRepo(ctx, repo, options));
  return reports;
}

/** Arch Linux Archive snapshot (https://archive.archlinux.org/repos/YYYY/MM/DD/): same parser, snapshot store. */
export async function syncSnapshot(ctx: Context, date: string, options: { repos?: readonly string[]; files?: boolean } = {}): Promise<RepoSyncReport[]> {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(date);
  if (!m) throw new Error(`Snapshot date must be YYYY-MM-DD, got "${date}".`);
  const base = `${ctx.endpoints.archive}/${m[1]}/${m[2]}/${m[3]}`;
  const reports: RepoSyncReport[] = [];
  for (const repo of options.repos ?? DEFAULT_REPOS) reports.push(await syncRepo(ctx, repo, { files: options.files, dbBase: base }));
  ctx.store.setMeta("snapshot_date", `${m[1]}-${m[2]}-${m[3]}`);
  return reports;
}

/** pacman Server line that pins a machine to an Arch Linux Archive date. */
export function snapshotMirrorlist(date: string): string {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(date);
  if (!m) throw new Error(`Snapshot date must be YYYY-MM-DD, got "${date}".`);
  return `Server = https://archive.archlinux.org/repos/${m[1]}/${m[2]}/${m[3]}/$repo/os/$arch\n`;
}

// ---- AUR ------------------------------------------------------------------------------------------------------------

export interface AurSyncReport {
  status: "updated" | "not-modified" | "fresh" | "error";
  packages?: number;
  added?: number;
  updated?: number;
  removed?: number;
  bytes?: number;
  jsonBytes?: number;
  ms: number;
  error?: string;
}

export async function syncAur(ctx: Context, options: { force?: boolean } = {}): Promise<AurSyncReport> {
  const started = performance.now();
  const url = ctx.endpoints.aurMeta;
  try {
    const state = ctx.store.getFetchState(url);
    if (!options.force && state && ctx.now() - state.checkedAt < AUR_META_MIN_INTERVAL_MS)
      return { status: "fresh", ms: performance.now() - started };
    const out = await ctx.client.get(url, { state: options.force || !state ? undefined : { etag: state.etag, lastModified: state.lastModified } });
    if (out.kind === "not-modified") {
      ctx.store.setFetchState(url, {}, false, ctx.now());
      return { status: "not-modified", ms: performance.now() - started };
    }
    const json = Bun.gunzipSync(out.body);
    const records = JSON.parse(new TextDecoder().decode(json)) as AurRecord[];
    if (!Array.isArray(records) || records.some((r, i) => i < 50 && (typeof r?.Name !== "string" || typeof r?.Version !== "string")))
      throw new Error("packages-meta-ext-v1.json.gz is not an array of AUR records.");
    assertNotShrunk("AUR metadata", ctx.store.count(undefined, "aur"), records.length, options.force);
    const result = ctx.store.replaceAur(records, { now: ctx.now(), emit: emitter(ctx) });
    ctx.store.setFetchState(url, { etag: out.etag, lastModified: out.lastModified, bytes: out.body.length, sha256: sha256Hex(out.body) }, true, ctx.now());
    return { status: "updated", packages: records.length, added: result.added, updated: result.updated, removed: result.removed, bytes: out.body.length, jsonBytes: json.length, ms: performance.now() - started };
  } catch (error) {
    return { status: "error", ms: performance.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

interface RpcAnswer {
  version?: number;
  type?: string;
  resultcount?: number;
  results?: AurRecord[];
  error?: string;
}

/** Live info for specific AUR packages through RPC v5 (batched, counted against the daily budget). */
export async function aurInfo(ctx: Context, names: string[], options: { batch?: number; store?: boolean } = {}): Promise<AurRecord[]> {
  const batch = options.batch ?? 100;
  const out: AurRecord[] = [];
  for (let i = 0; i < names.length; i += batch) {
    const chunk = names.slice(i, i + batch);
    if (ctx.store.rpcUsed() + 1 > AUR_RPC_DAILY_CAP)
      throw new Error(`AUR RPC daily budget reached (${ctx.store.rpcUsed()}/${AUR_RPC_DAILY_CAP}; the AUR allows 4000 per day and IP).`);
    const query = chunk.map(n => `arg[]=${encodeURIComponent(n)}`).join("&");
    ctx.store.rpcCount(1);
    const res = await ctx.client.get(`${ctx.endpoints.aurRpc}/info?${query}`, { headers: { accept: "application/json" } });
    if (res.kind !== "ok") throw new Error("Unexpected 304 for an unconditional RPC request.");
    const answer = JSON.parse(new TextDecoder().decode(res.body)) as RpcAnswer;
    if (answer.type === "error" || answer.error) throw new Error(`AUR RPC error: ${answer.error ?? "unknown"}`);
    out.push(...(answer.results ?? []));
  }
  if (options.store !== false && out.length) ctx.store.replaceAur(out, { partial: true, now: ctx.now(), emit: emitter(ctx) });
  return out;
}

export async function aurSearch(ctx: Context, term: string, by = "name-desc"): Promise<AurRecord[]> {
  if (ctx.store.rpcUsed() + 1 > AUR_RPC_DAILY_CAP) throw new Error("AUR RPC daily budget reached.");
  ctx.store.rpcCount(1);
  const res = await ctx.client.get(`${ctx.endpoints.aurRpc}/search/${encodeURIComponent(term)}?by=${encodeURIComponent(by)}`);
  if (res.kind !== "ok") throw new Error("Unexpected 304.");
  const answer = JSON.parse(new TextDecoder().decode(res.body)) as RpcAnswer;
  if (answer.type === "error" || answer.error) throw new Error(`AUR RPC error: ${answer.error ?? "unknown"}`);
  return answer.results ?? [];
}

// ---- news and feeds -------------------------------------------------------------------------------------------------

export async function syncNews(ctx: Context): Promise<{ status: "updated" | "not-modified" | "error"; fresh: number; error?: string }> {
  const url = `${ctx.endpoints.archlinuxOrg}/feeds/news/`;
  try {
    const state = ctx.store.getFetchState(url);
    const out = await ctx.client.get(url, { state: state ? { etag: state.etag, lastModified: state.lastModified } : undefined });
    if (out.kind === "not-modified") {
      ctx.store.setFetchState(url, {}, false, ctx.now());
      return { status: "not-modified", fresh: 0 };
    }
    const items = parseRss(new TextDecoder().decode(out.body));
    const firstRun = ctx.store.getMeta("news_seen") === null;
    const fresh = ctx.store.upsertNews(items.map(i => ({ guid: i.guid, title: i.title, link: i.link, published: i.published, summary: i.description })));
    ctx.store.setMeta("news_seen", "1");
    ctx.store.setFetchState(url, { etag: out.etag, lastModified: out.lastModified, bytes: out.body.length }, true, ctx.now());
    if (!firstRun)
      for (const n of fresh) emitter(ctx)(ctx.store.addEvent({ type: "news", source: "archlinux.org", name: n.title, new: n.link, data: { published: n.published }, ts: ctx.now() }));
    return { status: "updated", fresh: fresh.length };
  } catch (error) {
    return { status: "error", fresh: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface CrossCheckReport {
  source: string;
  checked: number;
  matching: number;
  /** Database is newer than the reference (reference lags). */
  ahead: { name: string; db: string; reference: string }[];
  /** Database is older than the reference (mirror lag or stale index). */
  behind: { name: string; db: string; reference: string }[];
  missing: string[];
}

/** Compare the newest entries of the "recent package updates" feed against the database. */
export async function crossCheckFeed(ctx: Context): Promise<CrossCheckReport> {
  const out = await ctx.client.get(`${ctx.endpoints.archlinuxOrg}/feeds/packages/`);
  if (out.kind !== "ok") throw new Error("Unexpected 304.");
  const report: CrossCheckReport = { source: "archlinux.org/feeds/packages", checked: 0, matching: 0, ahead: [], behind: [], missing: [] };
  for (const item of parseRss(new TextDecoder().decode(out.body))) {
    const t = parsePackageFeedTitle(item.title);
    if (!t) continue;
    report.checked++;
    const repo = item.categories[0];
    const row = ctx.store.getPackage(t.name, { source: "repo", repo: repo && /^[a-z0-9-]+$/.test(repo) ? repo.toLowerCase() : undefined, testing: true });
    if (!row) report.missing.push(t.name);
    else {
      const c = vercmp(row.version, t.version);
      if (c === 0) report.matching++;
      else if (c > 0) report.ahead.push({ name: t.name, db: row.version, reference: t.version });
      else report.behind.push({ name: t.name, db: row.version, reference: t.version });
    }
  }
  return report;
}

interface ApiResult {
  pkgname: string;
  pkgver: string;
  pkgrel: string;
  epoch: number;
  repo: string;
  build_date: string;
}

/** Compare named packages against the archlinux.org JSON API (one request per name; use for spot checks). */
export async function crossCheckApi(ctx: Context, names: string[]): Promise<CrossCheckReport> {
  const report: CrossCheckReport = { source: "archlinux.org/packages/search/json", checked: 0, matching: 0, ahead: [], behind: [], missing: [] };
  for (const name of names) {
    const out = await ctx.client.get(`${ctx.endpoints.archlinuxOrg}/packages/search/json/?name=${encodeURIComponent(name)}`);
    if (out.kind !== "ok") throw new Error("Unexpected 304.");
    const answer = JSON.parse(new TextDecoder().decode(out.body)) as { valid: boolean; results: ApiResult[] };
    const stable = answer.results.find(r => !/-(testing|staging)$/.test(r.repo)) ?? answer.results[0];
    report.checked++;
    if (!stable) {
      report.missing.push(name);
      continue;
    }
    const ref = `${stable.epoch ? `${stable.epoch}:` : ""}${stable.pkgver}-${stable.pkgrel}`;
    const row = ctx.store.getPackage(name, { source: "repo", repo: stable.repo, testing: true });
    if (!row) report.missing.push(name);
    else {
      const c = vercmp(row.version, ref);
      if (c === 0) report.matching++;
      else if (c > 0) report.ahead.push({ name, db: row.version, reference: ref });
      else report.behind.push({ name, db: row.version, reference: ref });
    }
  }
  return report;
}

// ---- sources: .SRCINFO and PKGBUILD ---------------------------------------------------------------------------------

/** Git tag used by Arch packaging repositories: epoch:pkgver-pkgrel with ":" -> "-" and "~" -> "_". */
export function gitTagFor(version: string): string {
  return version.replaceAll(":", "-").replaceAll("~", "_");
}

/** GitLab project path of a pkgbase ("+" is spelled "plus" there). */
export function gitlabProjectFor(pkgbase: string): string {
  return pkgbase.replaceAll("+", "plus");
}

export interface SourcesReport {
  source: "arch" | "aur";
  wanted: number;
  fetched: number;
  skipped: number;
  notFound: number;
  failed: number;
  drift: number;
  requests: number;
  bytes: number;
  ms: number;
  requestsPerSecond: number;
  errors: string[];
}

export interface SourcesOptions {
  /** Restrict to these pkgbase names. */
  names?: string[];
  limit?: number;
  /** Also fetch PKGBUILD (a second request per pkgbase). */
  pkgbuild?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length && !signal?.aborted) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, run));
}

async function getText(ctx: Context, url: string): Promise<{ text: string; ref?: string } | null> {
  try {
    const out = await ctx.client.get(url);
    if (out.kind !== "ok") return null;
    return { text: new TextDecoder().decode(out.body) };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/** Fetch .SRCINFO (and optionally PKGBUILD) of official packages at the exact released tag, once per version. */
export async function syncOfficialSources(ctx: Context, options: SourcesOptions = {}): Promise<SourcesReport> {
  const started = performance.now();
  const before = ctx.client.stats.requests;
  const bytes0 = ctx.client.stats.bytes;
  const rows = ctx.store.db
    .query(
      `SELECT base, version FROM packages WHERE source = 'repo' AND repo NOT LIKE '%-testing' AND repo NOT LIKE '%-staging' GROUP BY base ORDER BY base`,
    )
    .all() as { base: string; version: string }[];
  const filter = options.names ? new Set(options.names) : null;
  let todo = rows.filter(r => (!filter || filter.has(r.base)) && !ctx.store.hasSrcinfo("arch", r.base, r.version));
  const skipped = rows.length - todo.length;
  if (options.limit) todo = todo.slice(0, options.limit);
  const report: SourcesReport = { source: "arch", wanted: todo.length, fetched: 0, skipped, notFound: 0, failed: 0, drift: 0, requests: 0, bytes: 0, ms: 0, requestsPerSecond: 0, errors: [] };
  let done = 0;
  await pool(
    todo,
    options.concurrency ?? 1,
    async ({ base, version }) => {
      try {
        const project = `${ctx.endpoints.gitlabRaw}/${gitlabProjectFor(base)}/-/raw`;
        let ref = gitTagFor(version);
        let srcinfo = await getText(ctx, `${project}/${ref}/.SRCINFO`);
        if (!srcinfo) {
          // Tag missing: the default branch may be ahead of the repository, which we then record as drift.
          ref = "main";
          srcinfo = await getText(ctx, `${project}/main/.SRCINFO`);
        }
        if (!srcinfo) {
          report.notFound++;
          return;
        }
        const parsed = parseSrcinfo(srcinfo.text);
        let pkgbuild: string | undefined;
        if (options.pkgbuild) pkgbuild = (await getText(ctx, `${project}/${ref}/PKGBUILD`))?.text;
        const actual = parsed.version;
        if (actual !== version) report.drift++;
        ctx.store.putSources("arch", base, actual, ref, { srcinfo: srcinfo.text, pkgbuild, entries: parsed.sources }, ctx.now());
        report.fetched++;
      } catch (error) {
        report.failed++;
        if (report.errors.length < 10) report.errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        options.onProgress?.(++done, todo.length);
      }
    },
    options.signal,
  );
  report.requests = ctx.client.stats.requests - before;
  report.bytes = ctx.client.stats.bytes - bytes0;
  report.ms = performance.now() - started;
  report.requestsPerSecond = report.requests / Math.max(0.001, report.ms / 1000);
  return report;
}

/** Fetch .SRCINFO (and optionally PKGBUILD) of AUR packages from cgit, only for versions not stored yet. */
export async function syncAurSources(ctx: Context, options: SourcesOptions = {}): Promise<SourcesReport> {
  const started = performance.now();
  const before = ctx.client.stats.requests;
  const bytes0 = ctx.client.stats.bytes;
  const rows = ctx.store.db.query(`SELECT base, version, MAX(popularity) AS pop FROM packages WHERE repo = 'aur' GROUP BY base ORDER BY pop DESC, base`).all() as {
    base: string;
    version: string;
  }[];
  const filter = options.names ? new Set(options.names) : null;
  let todo = rows.filter(r => (!filter || filter.has(r.base)) && !ctx.store.hasSrcinfo("aur", r.base, r.version));
  const skipped = rows.length - todo.length;
  if (options.limit) todo = todo.slice(0, options.limit);
  const report: SourcesReport = { source: "aur", wanted: todo.length, fetched: 0, skipped, notFound: 0, failed: 0, drift: 0, requests: 0, bytes: 0, ms: 0, requestsPerSecond: 0, errors: [] };
  let done = 0;
  await pool(
    todo,
    options.concurrency ?? 1,
    async ({ base, version }) => {
      try {
        const q = `?h=${encodeURIComponent(base)}`;
        const srcinfo = await getText(ctx, `${ctx.endpoints.aurCgit}/.SRCINFO${q}`);
        if (!srcinfo) {
          report.notFound++;
          return;
        }
        const parsed = parseSrcinfo(srcinfo.text);
        let pkgbuild: string | undefined;
        if (options.pkgbuild) pkgbuild = (await getText(ctx, `${ctx.endpoints.aurCgit}/PKGBUILD${q}`))?.text;
        if (parsed.version !== version) report.drift++;
        ctx.store.putSources("aur", base, parsed.version, "HEAD", { srcinfo: srcinfo.text, pkgbuild, entries: parsed.sources }, ctx.now());
        report.fetched++;
      } catch (error) {
        report.failed++;
        if (report.errors.length < 10) report.errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        options.onProgress?.(++done, todo.length);
      }
    },
    options.signal,
  );
  report.requests = ctx.client.stats.requests - before;
  report.bytes = ctx.client.stats.bytes - bytes0;
  report.ms = performance.now() - started;
  report.requestsPerSecond = report.requests / Math.max(0.001, report.ms / 1000);
  return report;
}

// ---- official WSL image ---------------------------------------------------------------------------------------------

export interface WslImageInfo {
  version: string;
  file: string;
  url: string;
  bytes: number;
  sha256: string | null;
  lastModified: string | null;
}

/** Latest official Arch WSL image (archlinux-wsl, built monthly, published on the Arch mirror). */
export async function wslImage(ctx: Context): Promise<WslImageInfo> {
  const dir = `${ctx.endpoints.wslIndex}/latest/`;
  const listing = await ctx.client.get(dir);
  if (listing.kind !== "ok") throw new Error("Unexpected 304.");
  const html = new TextDecoder().decode(listing.body);
  const m = [...html.matchAll(/<a href="(archlinux-(\d{4}\.\d{2}\.\d{2}\.\d+)\.wsl)">[^<]*<\/a>\s+(\d{2}-\w{3}-\d{4} \d{2}:\d{2})\s+(\d+)/g)][0];
  if (!m) throw new Error(`No versioned archlinux-*.wsl image found in ${dir}.`);
  let sha256: string | null = null;
  try {
    const sum = await ctx.client.get(`${dir}${m[1]}.SHA256`);
    if (sum.kind === "ok") sha256 = /^([0-9a-f]{64})/i.exec(new TextDecoder().decode(sum.body))?.[1]?.toLowerCase() ?? null;
  } catch {
    // checksum file unavailable: report null instead of guessing
  }
  return { version: m[2]!, file: m[1]!, url: `${dir}${m[1]}`, bytes: Number(m[4]), sha256, lastModified: m[3]! };
}
