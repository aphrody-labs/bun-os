// SPDX-License-Identifier: Apache-2.0
/**
 * One transfer service for the shell (through the sidecar), play (WebSocket topic `transfers`)
 * and the engine (bep):
 * - resumable downloads into `<dest>.part` with HTTP Range, sha256/sha512 integrity (the part is
 *   re-hashed on resume, then hashing continues with the stream), atomic rename on success;
 * - candidate URLs from the caller, plugin transfer providers (`bep:<service>/<path>` over
 *   mirrors.json) and LAN cache routing for Steam CDN hosts (Steam lancache);
 * - a queue persisted in bun:sqlite (`usr/var/lib/bun-os/transfers.db`): interrupted transfers are
 *   re-queued at the next start and resume from their part file;
 * - pause/resume, a global and per-transfer bandwidth cap, progress events;
 * - uploads and object targets on R2/S3 through Bun.S3Client, credentials only from the protected
 *   store (`~/.aphrody/config/cloudflare.env` + injected env, via the bun-cloudflare R2 owner), never
 *   printed.
 *
 * No dependency on @aphrody/bun-engine: bep imports this module.
 */
import { Database } from "bun:sqlite";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { lookup } from "node:dns/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ensureDir, platformPaths, readSettings } from "../paths";
import { slices, Throttle } from "./throttle";

export type TransferState = "queued" | "running" | "paused" | "done" | "failed";

export interface TransferRecord {
  id: string;
  kind: "download" | "upload";
  url: string;
  urls: string[];
  dest: string;
  sha256: string | null;
  sha512: string | null;
  size: number | null;
  received: number;
  state: TransferState;
  error: string | null;
  via: string | null;
  bandwidth: number;
  created: string;
  updated: string;
}

export interface TransferEvent {
  id: string;
  state: TransferState;
  received: number;
  size: number | null;
  /** Bytes per second over the last second. */
  rate: number;
  url: string;
  via: string | null;
  error: string | null;
}

export interface DownloadRequest {
  url: string;
  /** Extra candidate URLs, tried in order after the plugin providers' candidates. */
  mirrors?: string[];
  dest?: string;
  sha256?: string;
  sha512?: string;
  size?: number;
  /** Bytes per second for this transfer (0: only the global cap). */
  bandwidth?: number;
  id?: string;
}

type Resolver = (url: string) => Promise<string[]>;

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd])/;
const STEAM_CDN = /(^|\.)steamcontent\.com$|(^|\.)steampipe\.akamaized\.net$|^cache\d+-[a-z0-9-]+\.steamcontent\.com$/;

/** The LAN cache endpoint, if one is configured or announced by DNS (lancache.steamcontent.com). */
export async function lancacheEndpoint(): Promise<string | null> {
  const settings = (await readSettings()) as { lancache?: string };
  const configured = Bun.env.BUN_OS_LANCACHE ?? settings.lancache;
  if (configured) return configured.replace(/\/$/, "");
  try {
    const { address } = await lookup("lancache.steamcontent.com");
    if (PRIVATE_IP.test(address)) return `http://${address}`;
  } catch {
    /* no LAN cache announced */
  }
  return null;
}

export class TransferService extends EventTarget {
  readonly db: Database;
  readonly global: Throttle;
  private readonly running = new Map<string, AbortController>();
  private readonly resolvers: Resolver[] = [];
  private readonly rates = new Map<string, { at: number; bytes: number; rate: number }>();
  concurrency = 3;

  constructor(options: { db?: string; bandwidth?: number } = {}) {
    super();
    const file = options.db ?? platformPaths().transfersDb;
    ensureDir(dirname(file));
    this.db = new Database(file, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, url TEXT NOT NULL, urls TEXT NOT NULL DEFAULT '[]',
      dest TEXT NOT NULL, sha256 TEXT, sha512 TEXT, size INTEGER, received INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL, error TEXT, via TEXT, bandwidth INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL, updated TEXT NOT NULL)`);
    // A killed process leaves `running` rows: they resume from their part file.
    this.db.run("UPDATE transfers SET state = 'queued' WHERE state = 'running'");
    this.global = new Throttle(options.bandwidth ?? 0);
  }

  /** Adds a candidate resolver (plugin transfer providers register here). */
  addResolver(resolver: Resolver): void {
    this.resolvers.push(resolver);
  }

  list(): TransferRecord[] {
    return (
      this.db.query("SELECT * FROM transfers ORDER BY created").all() as (Omit<TransferRecord, "urls"> & {
        urls: string;
      })[]
    ).map(r => ({
      ...r,
      urls: JSON.parse(r.urls) as string[],
    }));
  }

  get(id: string): TransferRecord | null {
    return this.list().find(r => r.id === id) ?? null;
  }

  private update(id: string, patch: Partial<Omit<TransferRecord, "id" | "urls">>): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.db
      .query(`UPDATE transfers SET ${keys.map(k => `${k} = $${k}`).join(", ")}, updated = $updated WHERE id = $id`)
      .run({ ...patch, updated: new Date().toISOString(), id } as never);
  }

  private emit(r: TransferRecord): void {
    const now = performance.now();
    const prev = this.rates.get(r.id);
    let rate = prev?.rate ?? 0;
    if (prev && now - prev.at >= 1000) rate = ((r.received - prev.bytes) * 1000) / (now - prev.at);
    if (!prev || now - prev.at >= 1000) this.rates.set(r.id, { at: now, bytes: r.received, rate });
    const detail: TransferEvent = {
      id: r.id,
      state: r.state,
      received: r.received,
      size: r.size,
      rate: Math.max(0, Math.round(rate)),
      url: r.url,
      via: r.via,
      error: r.error,
    };
    this.dispatchEvent(new CustomEvent("progress", { detail }));
  }

  /** Queues a download (idempotent by id) and starts the queue. */
  enqueue(request: DownloadRequest): TransferRecord {
    const id =
      request.id ??
      new Bun.CryptoHasher("sha256")
        .update(`${request.url}\0${request.dest ?? ""}`)
        .digest("hex")
        .slice(0, 16);
    const existing = this.get(id);
    if (existing && existing.state !== "failed") {
      if (existing.state === "paused") this.resume(id);
      else void this.pump();
      return existing;
    }
    const dest =
      request.dest ??
      join(platformPaths().downloads, basename(new URL(request.url.replace(/^bep:/, "https://bep/")).pathname) || id);
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT OR REPLACE INTO transfers (id, kind, url, urls, dest, sha256, sha512, size, received, state, bandwidth, created, updated)
              VALUES ($id, 'download', $url, $urls, $dest, $sha256, $sha512, $size, 0, 'queued', $bandwidth, $now, $now)`,
      )
      .run({
        id,
        url: request.url,
        urls: JSON.stringify(request.mirrors ?? []),
        dest,
        sha256: request.sha256?.toLowerCase() ?? null,
        sha512: request.sha512?.toLowerCase() ?? null,
        size: request.size ?? null,
        bandwidth: request.bandwidth ?? 0,
        now,
      });
    void this.pump();
    return this.get(id) as TransferRecord;
  }

  pause(id: string): void {
    this.running.get(id)?.abort("paused");
    this.update(id, { state: "paused" });
    const r = this.get(id);
    if (r) this.emit(r);
  }

  resume(id: string): void {
    const r = this.get(id);
    if (!r || r.state === "done" || r.state === "running") return;
    this.update(id, { state: "queued", error: null });
    void this.pump();
  }

  cancel(id: string): void {
    this.running.get(id)?.abort("cancelled");
    const r = this.get(id);
    if (r) rmSync(`${r.dest}.part`, { force: true });
    this.db.query("DELETE FROM transfers WHERE id = $id").run({ id });
  }

  /** Starts queued transfers up to the concurrency limit. */
  async pump(): Promise<void> {
    const queued = this.list().filter(r => r.state === "queued");
    for (const r of queued) {
      if (this.running.size >= this.concurrency) break;
      if (this.running.has(r.id)) continue;
      const controller = new AbortController();
      this.running.set(r.id, controller);
      void this.run(r, controller.signal).finally(() => {
        this.running.delete(r.id);
        void this.pump();
      });
    }
  }

  /** Resolves when the transfer leaves the queue (done, failed or paused). */
  wait(id: string): Promise<TransferRecord> {
    return new Promise(resolve => {
      const check = () => {
        const r = this.get(id);
        if (!r || r.state === "done" || r.state === "failed" || r.state === "paused") {
          this.removeEventListener("progress", onProgress);
          resolve(r as TransferRecord);
          return true;
        }
        return false;
      };
      const onProgress = (e: Event) => {
        if ((e as CustomEvent<TransferEvent>).detail.id === id) check();
      };
      this.addEventListener("progress", onProgress);
      check();
    });
  }

  private async candidates(
    r: TransferRecord,
  ): Promise<{ url: string; via: string; headers: Record<string, string> }[]> {
    const urls: string[] = [];
    for (const spec of [r.url, ...r.urls]) {
      if (/^https?:/.test(spec)) urls.push(spec);
      for (const resolve of this.resolvers) {
        try {
          urls.push(...(await resolve(spec)));
        } catch {
          /* a provider failing leaves the others */
        }
      }
    }
    const lancache = await lancacheEndpoint();
    const out: { url: string; via: string; headers: Record<string, string> }[] = [];
    for (const url of new Set(urls)) {
      const u = new URL(url);
      if (lancache && STEAM_CDN.test(u.hostname))
        out.push({
          url: `${lancache}${u.pathname}${u.search}`,
          via: "lancache",
          headers: { host: u.host },
        });
      out.push({ url, via: u.host, headers: {} });
    }
    return out;
  }

  private async run(record: TransferRecord, signal: AbortSignal): Promise<void> {
    const r = { ...record, state: "running" as TransferState };
    this.update(r.id, { state: "running", error: null });
    const part = `${r.dest}.part`;
    mkdirSync(dirname(r.dest), { recursive: true });
    const hashers = {
      sha256: r.sha256 ? new Bun.CryptoHasher("sha256") : null,
      sha512: r.sha512 ? new Bun.CryptoHasher("sha512") : null,
    };
    // Resume: hash what is already on disk (bounded reads), then continue from there.
    let offset = existsSync(part) ? statSync(part).size : 0;
    if (offset > 0 && (hashers.sha256 || hashers.sha512)) {
      for await (const chunk of Bun.file(part).stream()) {
        hashers.sha256?.update(chunk);
        hashers.sha512?.update(chunk);
      }
    }
    r.received = offset;
    const perTransfer = new Throttle(r.bandwidth);
    const candidates = await this.candidates(r);
    let lastError = "no candidate URL";
    for (const candidate of candidates) {
      if (signal.aborted) break;
      try {
        const headers: Record<string, string> = {
          ...candidate.headers,
          "user-agent": "bun-os-platform/1.4.4",
        };
        if (offset > 0) headers.range = `bytes=${offset}-`;
        const response = await fetch(candidate.url, {
          headers,
          signal,
          redirect: "follow",
        });
        if (response.status === 416 && r.size !== null && offset === r.size) {
          /* already complete */
        } else if (!response.ok) {
          lastError = `${candidate.via}: HTTP ${response.status}`;
          continue;
        }
        if (offset > 0 && response.status === 200) {
          // The mirror ignored Range: start over.
          offset = 0;
          r.received = 0;
          hashers.sha256 = r.sha256 ? new Bun.CryptoHasher("sha256") : null;
          hashers.sha512 = r.sha512 ? new Bun.CryptoHasher("sha512") : null;
          if (existsSync(part)) {
            const fd = openSync(part, "r+");
            ftruncateSync(fd, 0);
            closeSync(fd);
          }
        }
        const length = Number(response.headers.get("content-length") ?? Number.NaN);
        if (r.size === null && Number.isFinite(length)) r.size = offset + length;
        r.via = candidate.via;
        r.url = candidate.url;
        this.update(r.id, { size: r.size, via: r.via });
        const fd = openSync(part, "a");
        let lastEmit = 0;
        try {
          if (response.body && response.status !== 416)
            for await (const chunk of response.body) {
              for (const piece of slices(chunk, 64 * 1024)) {
                await this.global.take(piece.length);
                await perTransfer.take(piece.length);
                if (signal.aborted) throw new DOMException(String(signal.reason), "AbortError");
                writeSync(fd, piece);
                hashers.sha256?.update(piece);
                hashers.sha512?.update(piece);
                r.received += piece.length;
                offset = r.received;
                const now = performance.now();
                if (now - lastEmit > 200) {
                  lastEmit = now;
                  this.update(r.id, { received: r.received });
                  this.emit(r);
                }
              }
            }
        } finally {
          closeSync(fd);
        }
        this.update(r.id, { received: r.received });
        for (const [algorithm, hasher] of Object.entries(hashers)) {
          if (!hasher) continue;
          const expected = (algorithm === "sha256" ? r.sha256 : r.sha512) as string;
          const actual = hasher.digest("hex");
          if (actual !== expected) {
            rmSync(part, { force: true });
            throw new Error(`${algorithm} mismatch: expected ${expected}, got ${actual}`);
          }
        }
        renameSync(part, r.dest);
        r.state = "done";
        this.update(r.id, { state: "done", received: r.received, error: null });
        this.emit(r);
        return;
      } catch (error) {
        if (signal.aborted) break;
        lastError = `${candidate.via}: ${(error as Error).message}`;
        if (/mismatch/.test(lastError)) break;
      }
    }
    if (signal.aborted) {
      const state: TransferState = signal.reason === "cancelled" ? "failed" : "paused";
      r.state = state;
      if (state === "paused") this.update(r.id, { state, received: r.received });
      this.emit(r);
      return;
    }
    r.state = "failed";
    r.error = lastError;
    this.update(r.id, {
      state: "failed",
      error: lastError,
      received: r.received,
    });
    this.emit(r);
  }
}

let shared: TransferService | null = null;

/** The process-wide service, with plugin transfer providers and the settings bandwidth cap. */
export async function transfers(): Promise<TransferService> {
  if (shared) return shared;
  const settings = await readSettings();
  const service = new TransferService({ bandwidth: settings.bandwidth ?? 0 });
  const { plugins } = await import("../plugins");
  const registry = await plugins();
  for (const p of registry.providers) service.addResolver(async url => (p.match(url) ? p.resolve(url) : []));
  shared = service;
  void service.pump();
  return service;
}

// ------------------------------------------------------------------ object storage (R2 / S3)

interface R2Owner {
  loadCloudflareEnvironment(file?: string): Promise<Record<string, string | undefined>>;
  createR2Client(o: { bucket: string; env: Record<string, string | undefined> }): Bun.S3Client;
}

/** Parses a `KEY=VALUE` env file (comments, optional quotes); a missing file is an empty environment. */
async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  const env: Record<string, string> = {};
  for (const line of (await file.text()).split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/** The R2 owner: the protected store (`~/.aphrody/config/cloudflare.env`) under the injected environment, over Bun.S3Client. */
function r2Owner(): Promise<R2Owner> {
  return Promise.resolve({
    async loadCloudflareEnvironment(file = join(homedir(), ".aphrody", "config", "cloudflare.env")) {
      return { ...(await readEnvFile(file)), ...process.env };
    },
    createR2Client({ bucket, env }) {
      const endpoint = env.R2_ENDPOINT ?? env.AWS_ENDPOINT_URL_S3;
      const accessKeyId = env.R2_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
      if (!endpoint || !accessKeyId || !secretAccessKey)
        throw new Error("R2 credentials are not in the protected store");
      return new Bun.S3Client({ bucket, endpoint, accessKeyId, secretAccessKey, region: "auto" });
    },
  });
}

async function credentials(): Promise<Record<string, string | undefined>> {
  const { loadCloudflareEnvironment } = await r2Owner();
  const env = await loadCloudflareEnvironment();
  // The protected store documents AWS_ENDPOINT_URL_S3; the R2 owner reads R2_ENDPOINT.
  return { ...env, R2_ENDPOINT: env.R2_ENDPOINT ?? env.AWS_ENDPOINT_URL_S3 };
}

/** Whether object credentials are present in the protected store (no value is exposed). */
export async function objectCredentialsPresent(): Promise<{
  endpoint: boolean;
  accessKey: boolean;
  secret: boolean;
}> {
  const env = await credentials();
  return {
    endpoint: Boolean(env.R2_ENDPOINT),
    accessKey: Boolean(env.R2_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID),
    secret: Boolean(env.R2_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY),
  };
}

/**
 * The S3 client of `bucket`. Every call is wrapped so an access refusal names the missing step:
 * the R2 key of the protected store must be granted on that bucket (or a key issued for it), a
 * credential change only the owner makes.
 */
async function client(bucket: string): Promise<Bun.S3Client> {
  const { createR2Client } = await r2Owner();
  const s3 = createR2Client({ bucket, env: await credentials() });
  const explain = (error: unknown): never => {
    const e = error as { code?: string; message?: string };
    // HEAD requests (stat) carry no error body: a key-scope refusal surfaces as UnknownError.
    if (e?.code === "AccessDenied" || e?.code === "UnknownError" || /access denied/i.test(e?.message ?? ""))
      throw Object.assign(
        new Error(
          `R2 refused access to bucket "${bucket}": the R2 S3 key in the protected store (~/.aphrody/config/cloudflare.env) is not granted on it. The owner must grant that key on "${bucket}" or issue an R2 key for it and store it there; nothing else is missing.`,
        ),
        { code: "AccessDenied", bucket },
      );
    throw error;
  };
  const wrapFile = (file: Bun.S3File): Bun.S3File =>
    new Proxy(file, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        if (prop === "writer") {
          return (...args: unknown[]) => {
            const w = (value as (...a: unknown[]) => Bun.NetworkSink).apply(target, args);
            return new Proxy(w, {
              get(t, p, r) {
                const v = Reflect.get(t, p, r);
                if (p === "end" || p === "flush")
                  return (...a: unknown[]) =>
                    Promise.resolve((v as (...x: unknown[]) => unknown).apply(t, a)).catch(explain);
                return typeof v === "function" ? v.bind(t) : v;
              },
            });
          };
        }
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          return out instanceof Promise ? out.catch(explain) : out;
        };
      },
    });
  return new Proxy(s3, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "file")
        return (...args: unknown[]) => wrapFile((value as (...a: unknown[]) => Bun.S3File).apply(target, args));
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export interface ObjectTarget {
  /** `<bucket>/<prefix>`, safe to log. */
  id: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  stat(key: string): Promise<{ size: number; etag?: string } | null>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

/** Parses `s3://<bucket>/<prefix>`, `r2://<bucket>/<prefix>`, `r2:private[/<prefix>]`, `r2:<bucket>[/<prefix>]`. */
export function parseObjectSpec(spec: string, settingsBucket?: string): { bucket: string; prefix: string } {
  const m =
    /^(?:s3|r2):\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(spec) ??
    /^r2:([a-z0-9][a-z0-9-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(spec);
  if (!m) throw new TypeError(`unsupported object spec ${spec}`);
  let bucket = m[1] as string;
  if (bucket === "private") {
    const configured = Bun.env.BUN_OS_R2_PRIVATE_BUCKET ?? settingsBucket;
    if (!configured)
      throw new Error(
        "no private bucket configured: set uploadBucket in usr/etc/bun-os/settings.json or BUN_OS_R2_PRIVATE_BUCKET",
      );
    bucket = configured;
  }
  const prefix = (m[2] ?? "").replace(/^\/+|\/+$/g, "");
  return { bucket, prefix };
}

/**
 * Opaque byte storage for other owners (bep's encrypted dumps): put/stat/get/delete under a
 * prefix, honoring the bandwidth cap (per target, plus the global cap of the settings).
 */
export async function objectTarget(
  spec: string,
  options: { private?: boolean; bandwidth?: number } = {},
): Promise<ObjectTarget> {
  const settings = await readSettings();
  const { bucket, prefix } = parseObjectSpec(spec, settings.uploadBucket);
  const privateBucket = Bun.env.BUN_OS_R2_PRIVATE_BUCKET ?? settings.uploadBucket;
  if (options.private && bucket !== privateBucket)
    throw new Error(`${bucket} is not the configured private bucket; use r2:private`);
  const s3 = await client(bucket);
  const local = new Throttle(options.bandwidth ?? 0);
  const global = new Throttle(settings.bandwidth ?? 0);
  const keyOf = (key: string) => {
    if (!key || key.includes("..") || key.startsWith("/")) throw new TypeError(`invalid object key ${key}`);
    return prefix ? `${prefix}/${key}` : key;
  };
  const acl = options.private ? ({ acl: "private" } as const) : {};
  return {
    id: prefix ? `${bucket}/${prefix}` : bucket,
    async put(key, bytes) {
      const file = s3.file(keyOf(key), acl);
      if (!(options.bandwidth || settings.bandwidth)) {
        await file.write(bytes);
        return;
      }
      const writer = file.writer({
        partSize: 5 * 1024 * 1024,
        retry: 2,
        ...acl,
      });
      for (const piece of slices(bytes, 256 * 1024)) {
        await global.take(piece.length);
        await local.take(piece.length);
        writer.write(piece);
      }
      await writer.end();
    },
    async stat(key) {
      try {
        const s = await s3.file(keyOf(key)).stat();
        return { size: s.size, etag: s.etag };
      } catch (error) {
        const e = error as { code?: string; message?: string };
        if (/NoSuchKey|NotFound/i.test(e.code ?? "") || /not ?found|NoSuchKey|404/i.test(e.message ?? "")) return null;
        throw error;
      }
    },
    async get(key) {
      const file = s3.file(keyOf(key));
      if (!(options.bandwidth || settings.bandwidth)) return file.bytes();
      const parts: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of file.stream()) {
        await global.take(chunk.length);
        await local.take(chunk.length);
        parts.push(chunk);
        total += chunk.length;
      }
      const out = new Uint8Array(total);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    },
    async delete(key) {
      await s3.file(keyOf(key)).delete();
    },
  };
}

/** Uploads a local file (screenshot, save, user theme or plugin) with progress events. */
export async function uploadFile(
  path: string,
  options: {
    spec?: string;
    key?: string;
    contentType?: string;
    onProgress?: (sent: number, size: number) => void;
  } = {},
): Promise<{ bucket: string; key: string; size: number; sha256: string }> {
  const settings = await readSettings();
  const { bucket, prefix } = parseObjectSpec(options.spec ?? "r2:private/bun-os/uploads", settings.uploadBucket);
  const s3 = await client(bucket);
  const source = Bun.file(path);
  const size = source.size;
  const key = `${prefix ? `${prefix}/` : ""}${options.key ?? basename(path)}`;
  const hasher = new Bun.CryptoHasher("sha256");
  const writer = s3.file(key).writer({
    partSize: 5 * 1024 * 1024,
    retry: 2,
    type: options.contentType ?? source.type,
  });
  const throttle = new Throttle(settings.bandwidth ?? 0);
  let sent = 0;
  for await (const chunk of source.stream()) {
    await throttle.take(chunk.length);
    hasher.update(chunk);
    writer.write(chunk);
    sent += chunk.length;
    options.onProgress?.(sent, size);
  }
  await writer.end();
  return { bucket, key, size, sha256: hasher.digest("hex") };
}

export async function deleteObject(spec: string, key: string): Promise<void> {
  const settings = await readSettings();
  const { bucket } = parseObjectSpec(spec, settings.uploadBucket);
  await (await client(bucket)).file(key).delete();
}

export async function statObject(spec: string, key: string): Promise<{ size: number; etag?: string } | null> {
  const settings = await readSettings();
  const { bucket } = parseObjectSpec(spec, settings.uploadBucket);
  try {
    const s = await (await client(bucket)).file(key).stat();
    return { size: s.size, etag: s.etag };
  } catch {
    return null;
  }
}
