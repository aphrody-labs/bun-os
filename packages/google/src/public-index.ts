// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-control-regex -- Index inputs reject raw control characters. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";

export interface PublicIndexInput {
  query: string;
  collection: string;
  num: number;
  start: number;
}
export interface PublicIndexBody {
  query: string;
  organic: { title: string; url: string; snippet: string }[];
  source: "public-crawl-cache";
  collection: string;
  generatedAt: string;
}
export interface PublicIndexCollection {
  pointer: string;
  hosts: string[];
  policySha256: string;
  owner: string;
}
export interface PublicIndexSdkOptions {
  root: string;
  collections: Record<string, PublicIndexCollection>;
}
export interface PublicIndexResult {
  body: PublicIndexBody;
  etag: string;
  cache: "hit" | "miss";
}
export type PublicIndexSearch = (input: PublicIndexInput, signal?: AbortSignal) => Promise<PublicIndexResult>;

const SHA = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_SNAPSHOT = 4 * 1024 * 1024;
const MAX_CACHE = 128;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
function reject(): never {
  throw new Error("Public index unavailable");
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Search aborted", "AbortError");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}
function publicHost(host: string) {
  return (
    host === host.toLowerCase() &&
    host.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test|home|lan|onion)$/.test(host)
  );
}
function samePath(a: string, b: string) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Reject symlinks/junctions in every component, including the configured root. */
async function checkedPath(path: string, directory: boolean, signal?: AbortSignal) {
  aborted(signal);
  const absolute = resolve(path);
  let current = parse(absolute).root;
  const components = absolute.slice(current.length).split(sep).filter(Boolean);
  for (let i = 0; i < components.length; i++) {
    current = join(current, components[i]!);
    const stat = await lstat(current);
    aborted(signal);
    if (stat.isSymbolicLink() || (i < components.length - 1 && !stat.isDirectory())) reject();
    if (i === components.length - 1 && (directory ? !stat.isDirectory() : !stat.isFile())) reject();
  }
  const canonical = await realpath(absolute);
  aborted(signal);
  if (!samePath(resolve(canonical), absolute)) reject();
  return absolute;
}

/** An opened descriptor is identity checked and reads at most limit + 1 bytes. */
async function readBounded(path: string, limit: number, signal?: AbortSignal) {
  await checkedPath(path, false, signal);
  const before = await lstat(path);
  aborted(signal);
  if (before.size > limit || before.nlink !== 1) reject();
  const file = await open(path, "r");
  try {
    const actual = await file.stat();
    if (
      !actual.isFile() ||
      actual.dev !== before.dev ||
      actual.ino !== before.ino ||
      actual.size !== before.size ||
      actual.nlink !== 1 ||
      actual.size > limit
    )
      reject();
    const buffer = Buffer.alloc(actual.size + 1);
    let length = 0;
    while (length < buffer.length) {
      aborted(signal);
      const read = await file.read(buffer, length, buffer.length - length, null);
      aborted(signal);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > actual.size) reject();
    await checkedPath(path, false, signal);
    const after = await lstat(path);
    if (after.dev !== actual.dev || after.ino !== actual.ino || after.size !== actual.size || after.nlink !== 1)
      reject();
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

interface Document {
  url: string;
  title: string;
  text: string;
}
function validateSnapshot(value: unknown, collection: string, policy: PublicIndexCollection) {
  const snapshot = object(value);
  const provenance = object(snapshot.provenance);
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.collection !== collection ||
    typeof snapshot.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.generatedAt) ||
    !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
    provenance.owner !== "aphrody-web-crawl" ||
    provenance.owner !== policy.owner ||
    provenance.policySha256 !== policy.policySha256 ||
    typeof provenance.sourceRevision !== "string" ||
    !/^[a-f0-9]{40}$/.test(provenance.sourceRevision) ||
    provenance.anonymous !== true ||
    provenance.public !== true ||
    !Array.isArray(snapshot.documents) ||
    snapshot.documents.length > 1000
  )
    reject();
  const coverage = object(snapshot.coverage);
  for (const key of ["attempted", "done", "pending", "failed", "exported"]) {
    if (!Number.isSafeInteger(coverage[key]) || (coverage[key] as number) < 0) reject();
  }
  if (
    typeof coverage.complete !== "boolean" ||
    typeof coverage.timedOut !== "boolean" ||
    coverage.exported !== snapshot.documents.length ||
    (coverage.locked !== undefined && (!Number.isSafeInteger(coverage.locked) || (coverage.locked as number) < 0)) ||
    (coverage.complete && (coverage.pending !== 0 || coverage.timedOut || (coverage.locked ?? 0) !== 0))
  )
    reject();
  const urls = new Set<string>();
  const documents: Document[] = snapshot.documents.map(raw => {
    const doc = object(raw);
    if (
      typeof doc.url !== "string" ||
      bytes(doc.url) > 8192 ||
      CONTROL.test(doc.url) ||
      typeof doc.title !== "string" ||
      bytes(doc.title) > 4096 ||
      CONTROL.test(doc.title) ||
      typeof doc.text !== "string" ||
      doc.text.includes("\0") ||
      Buffer.from(doc.text).toString("utf8") !== doc.text ||
      bytes(doc.text) > 32768 ||
      doc.contentBytes !== bytes(doc.text) ||
      doc.contentSha256 !== sha256(doc.text) ||
      (doc.originalContentSha256 !== undefined &&
        (typeof doc.originalContentSha256 !== "string" || !SHA.test(doc.originalContentSha256)))
    )
      reject();
    const url = new URL(doc.url);
    if (
      url.protocol !== "https:" ||
      !publicHost(url.hostname) ||
      !policy.hosts.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      urls.has(url.href)
    )
      reject();
    urls.add(url.href);
    return { url: url.href, title: doc.title, text: doc.text };
  });
  return { documents, generatedAt: snapshot.generatedAt };
}

/** Single bounded in-memory public projection. No implicit home/database/profile discovery. */
export function createPublicIndexSearch(options: PublicIndexSdkOptions): PublicIndexSearch & {
  close(): void;
} {
  if (!options || typeof options.root !== "string" || !isAbsolute(options.root)) reject();
  const root = resolve(options.root);
  const policies = new Map<string, PublicIndexCollection>();
  const collections = Object.entries(object(options.collections));
  if (!collections.length || collections.length > 8) reject();
  for (const [collection, raw] of collections) {
    const policy = object(raw);
    if (
      !SLUG.test(collection) ||
      policy.pointer !== `${collection}.pointer.json` ||
      policy.owner !== "aphrody-web-crawl" ||
      typeof policy.policySha256 !== "string" ||
      !SHA.test(policy.policySha256) ||
      !Array.isArray(policy.hosts) ||
      !policy.hosts.length ||
      policy.hosts.length > 256 ||
      policy.hosts.some(host => typeof host !== "string" || !publicHost(host))
    )
      reject();
    policies.set(collection, {
      pointer: policy.pointer,
      owner: policy.owner,
      policySha256: policy.policySha256,
      hosts: [...new Set(policy.hosts as string[])],
    });
  }
  const db = new Database(":memory:");
  // One database; bounded separate FTS statistics keep ranking/ETags collection-local.
  // Table names derive only from internal indices, never request/configuration text.
  const projections = new Map(
    [...policies.keys()].map((collection, index) => {
      const table = `pages_${index}`;
      db.exec(
        `CREATE VIRTUAL TABLE ${table} USING fts5(collection UNINDEXED, url UNINDEXED, title, text, tokenize='unicode61')`,
      );
      return [
        collection,
        {
          remove: db.query(`DELETE FROM ${table} WHERE collection = ?`),
          insert: db.query(`INSERT INTO ${table}(collection,url,title,text) VALUES (?,?,?,?)`),
          query: db.query<{ title: string; url: string; snippet: string }, [string, string, number, number]>(
            `SELECT title,url,snippet(${table},3,'','','…',32) AS snippet FROM ${table} WHERE ${table} MATCH ? AND collection = ? ORDER BY bm25(${table},0,0,3,1),url LIMIT ? OFFSET ?`,
          ),
        },
      ] as const;
    }),
  );
  const revisions = new Map<string, { sha: string; generatedAt: string }>();
  const cache = new Map<string, PublicIndexResult>();
  let queue = Promise.resolve();
  let closed = false;
  const search: PublicIndexSearch = async (input, signal) => {
    aborted(signal);
    if (
      !input ||
      typeof input.query !== "string" ||
      !input.query.trim() ||
      bytes(input.query) > 4096 ||
      Buffer.from(input.query).toString("utf8") !== input.query ||
      CONTROL.test(input.query) ||
      !policies.has(input.collection) ||
      !Number.isInteger(input.num) ||
      input.num < 1 ||
      input.num > 20 ||
      !Number.isInteger(input.start) ||
      input.start < 0 ||
      input.start > 1000
    )
      throw new Error("Invalid public index query");
    input = { ...input };
    const terms = input.query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (terms.length > 128) throw new Error("Invalid public index query");
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(done => {
      release = done;
    });
    await previous;
    try {
      aborted(signal);
      if (closed) reject();
      await checkedPath(root, true, signal);
      const policy = policies.get(input.collection)!;
      const projection = projections.get(input.collection)!;
      const pointer = object(JSON.parse(utf8.decode(await readBounded(join(root, policy.pointer), 2048, signal))));
      if (
        pointer.schemaVersion !== 1 ||
        pointer.collection !== input.collection ||
        typeof pointer.sha256 !== "string" ||
        !SHA.test(pointer.sha256) ||
        pointer.file !== `${pointer.sha256}.json`
      )
        reject();
      const snapshotBytes = await readBounded(join(root, pointer.file as string), MAX_SNAPSHOT, signal);
      if (sha256(snapshotBytes) !== pointer.sha256) reject();
      aborted(signal);
      const old = revisions.get(input.collection);
      if (old?.sha !== pointer.sha256) {
        const snapshot = validateSnapshot(JSON.parse(utf8.decode(snapshotBytes)), input.collection, policy);
        aborted(signal);
        db.transaction(() => {
          projection.remove.run(input.collection);
          for (const doc of snapshot.documents) projection.insert.run(input.collection, doc.url, doc.title, doc.text);
        })();
        revisions.set(input.collection, { sha: pointer.sha256, generatedAt: snapshot.generatedAt });
        cache.clear();
      }
      aborted(signal);
      const normalized = input.query.trim();
      const key = sha256(JSON.stringify([pointer.sha256, input.collection, normalized, input.num, input.start]));
      const found = cache.get(key);
      if (found) {
        cache.delete(key);
        cache.set(key, found);
        return { ...structuredClone(found), cache: "hit" };
      }
      const matches = terms.length
        ? projection.query.all(terms.map(term => `"${term}"`).join(" AND "), input.collection, input.num, input.start)
        : [];
      aborted(signal);
      const result: PublicIndexResult = {
        body: {
          query: normalized,
          organic: matches.map(hit => ({ ...hit, snippet: hit.snippet.slice(0, 512) })),
          source: "public-crawl-cache",
          collection: input.collection,
          generatedAt: revisions.get(input.collection)!.generatedAt,
        },
        etag: `"${key}"`,
        cache: "miss",
      };
      cache.set(key, structuredClone(result));
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
      return result;
    } catch (error) {
      aborted(signal);
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      reject();
    } finally {
      release();
    }
  };
  return Object.assign(search, {
    close() {
      if (closed) return;
      closed = true;
      cache.clear();
      revisions.clear();
      db.close();
    },
  });
}
