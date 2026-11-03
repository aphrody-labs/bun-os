// SPDX-License-Identifier: MIT
// Port of upstream scripts/catalog.py: the small read-only catalog interface shared by every helper.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type Collection, COLLECTIONS, type Manifest, recordFile, toPosix, validateManifest } from "./manifest-contract.ts";
import { skillRoot } from "./paths.ts";
import { canonical, parseLossless, plain, type PyValue, sha256 } from "./pyjson.ts";

/** One catalog record as stored, plus the loader-only `_path` (relative to the skill root). */
export interface CatalogRecord {
  id: string;
  revision: number;
  status?: string;
  title: { en: string };
  summary: string;
  knowledge_kind?: string;
  direction_ids?: string[];
  aliases?: { en?: string[] };
  related_ids?: string[];
  claims?: { source_refs?: { source_id: string }[] }[];
  _path: string;
  [key: string]: unknown;
}

export interface Source {
  id: string;
  [key: string]: unknown;
}

export interface Catalog {
  root: string;
  manifest: Manifest;
  records: CatalogRecord[];
  sources: Source[];
}

/** The lossless (float-preserving) form of every loaded object, used only for hashes. */
const LOSSLESS = new WeakMap<object, PyValue>();

export function lossless(value: object): PyValue {
  const found = LOSSLESS.get(value);
  if (found === undefined) throw new Error("not a catalog object");
  return found;
}

function readJson(path: string): { value: unknown; exact: PyValue } {
  const exact = parseLossless(readFileSync(path, "utf8"));
  return { value: plain(exact), exact };
}

const cache = new Map<string, Catalog>();

export function loadCatalog(root = skillRoot(), collection: Collection = "recipes"): Catalog {
  if (!COLLECTIONS.has(collection)) throw new Error("Unknown collection");
  const key = `${root}\0${collection}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = join(root, "data");
  const manifestJson = readJson(join(data, "manifest.json"));
  const manifest = manifestJson.value as Manifest;
  LOSSLESS.set(manifest, manifestJson.exact);
  const paths = validateManifest(manifest, data);
  const records: CatalogRecord[] = [];
  const selected = collection === "all" ? (["recipes", "knowledge"] as const) : ([collection] as const);
  for (const name of selected) {
    for (const path of paths[name] ?? []) {
      const { value, exact } = readJson(path);
      const rel = toPosix(relative(data, path));
      const rows = recordFile(value, rel, name, manifest.layout_version ?? 1);
      const exactRows = recordFile(exact, rel, name, manifest.layout_version ?? 1);
      rows.forEach((row, index) => {
        const _path = toPosix(relative(root, path));
        const record = { ...(row as object), _path } as CatalogRecord;
        LOSSLESS.set(record, { ...(exactRows[index] as Record<string, PyValue>), _path });
        records.push(record);
      });
    }
  }
  const ids = records.map(r => r.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate catalog IDs; validate the dataset before searching.");
  if (collection !== "knowledge" && !records.length) throw new Error("Empty recipe catalog; validate the installed package.");
  const sourcesJson = readJson(paths.sources![0]!);
  const sources = sourcesJson.value as Source[];
  (sourcesJson.exact as PyValue[]).forEach((exact, index) => LOSSLESS.set(sources[index]!, exact));
  const catalog = { root, manifest, records, sources };
  cache.set(key, catalog);
  return catalog;
}

/** sha256 of the canonical [manifest, records] bytes: upstream's catalog_hash. */
export function fingerprint(manifest: Manifest, records: CatalogRecord[]): string {
  const cached = fingerprints.get(records);
  if (cached?.manifest === manifest) return cached.hash;
  const hash = sha256(canonical([lossless(manifest), records.map(r => lossless(r))]));
  fingerprints.set(records, { manifest, hash });
  return hash;
}

const fingerprints = new WeakMap<CatalogRecord[], { manifest: Manifest; hash: string }>();

/** Same canonical bytes as evidence hashes, without the loader-only `_path`. */
export function recordContentHash(record: CatalogRecord): string {
  const { _path, ...stored } = lossless(record) as Record<string, PyValue>;
  return sha256(canonical(stored));
}

/** Content and layout hashes of a supplied catalog (both collections for the global summary). */
export function catalogHashes(records: CatalogRecord[]): { content_catalog_hash: string; layout_hash: string } {
  const ordered = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const digest = (value: unknown) => sha256(canonical(value));
  return {
    content_catalog_hash: digest(ordered.map(r => [r.id, r.revision, recordContentHash(r)])),
    layout_hash: digest(ordered.map(r => [r.id, r._path])),
  };
}

/** A dotted field's text: strings as is, string lists joined by spaces, anything else empty. */
export function fieldText(record: unknown, path: string): string {
  let value: unknown = record;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    value = (value as Record<string, unknown>)[part] ?? "";
  }
  if (Array.isArray(value)) return value.filter(v => typeof v === "string").join(" ");
  return typeof value === "string" ? value : "";
}
