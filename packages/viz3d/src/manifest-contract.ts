// SPDX-License-Identifier: MIT
// Port of upstream scripts/manifest_contract.py and record_layout.py: validate the retrieval manifest before
// reading any collection path, and check that every record sits where its ID and kind say it should.
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { casefold } from "./text.ts";

export const KNOWLEDGE_KINDS = new Set([
  "object-archetype",
  "material-profile",
  "physical-behavior",
  "tool-adapter",
  "inspection-pattern",
  "validation-profile",
  "style-profile",
  "theme-profile",
  "presentation-profile",
  "composition-profile",
  "motion-profile",
  "interaction-profile",
  "reasoning-rule",
  "domain-validation",
  "geometry-profile",
  "lighting-profile",
  "output-profile",
  "blueprint",
]);
export const COLLECTIONS = new Set(["recipes", "knowledge", "all"]);
export type Collection = "recipes" | "knowledge" | "all";

export const SEARCH_FIELDS = new Set([
  "title.en",
  "aliases.en",
  "summary",
  "objective",
  "tags",
  "subject_terms",
  "intent_signals",
  "example_prompts",
  "applies_when",
  "defaults.values.feeling",
]);
export const MAX_QUERY_ALIASES = 200;

export interface SearchConfig {
  version: number;
  tokenizer: string;
  algorithm: "weighted-field-bm25" | "overlap";
  k1: number;
  b: number;
  fields: Record<string, number>;
  query_aliases?: Record<string, string[]>;
}

export interface Manifest {
  schema_version: number;
  version: string;
  layout_version?: number;
  collections: Record<string, string>;
  search: SearchConfig;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Python pathlib ordering: compare path parts, not the joined string ("a" < "a-b" even though "a/" > "a-"). */
function byParts(a: string, b: string): number {
  const pa = a.split("/"),
    pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return pa.length - pb.length;
}

/** Collection name to its member files (absolute), sorted the way upstream's sorted(Path.glob()) sorts them. */
export function validateManifest(manifest: unknown, data: string): Record<string, string[]> {
  const m = manifest as Partial<Manifest> | null;
  if (!m || typeof m !== "object" || m.schema_version !== 1) throw new Error("Unsupported manifest schema");
  const layout = m.layout_version ?? 1;
  if (!Number.isInteger(layout) || ![1, 2].includes(layout)) throw new Error("Unsupported catalog layout version");
  const collections = m.collections;
  const names = collections && typeof collections === "object" ? Object.keys(collections) : [];
  const allowed = new Set(["recipes", "sources", "directions", "knowledge"]);
  if (
    !collections ||
    !["recipes", "sources", "directions"].every(n => names.includes(n)) ||
    names.some(n => !allowed.has(n))
  )
    throw new Error("Manifest requires recipes, sources and directions collections");
  const paths: Record<string, string[]> = {};
  const root = resolve(data);
  for (const [name, pattern] of Object.entries(collections)) {
    if (
      typeof pattern !== "string" ||
      pattern.includes("\\") ||
      pattern.includes(":") ||
      isAbsolute(pattern) ||
      pattern.split("/").includes("..")
    )
      throw new Error(`Unsafe collection path: ${name}`);
    const selected = existsSync(root)
      ? [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: false })]
          .map(p => p.replaceAll("\\", "/"))
          .sort(byParts)
      : [];
    if (selected.length === 0 || (!["recipes", "knowledge"].includes(name) && selected.length !== 1))
      throw new Error(`Missing or ambiguous collection: ${name}`);
    paths[name] = selected.map(rel => {
      const abs = join(root, rel);
      const inside = !relative(root, resolve(abs)).startsWith("..");
      if (!statSync(abs).isFile() || !rel.endsWith(".json") || !inside)
        throw new Error(`Invalid collection member: ${name}`);
      return abs;
    });
  }
  const cfg = (m.search ?? {}) as Partial<SearchConfig>;
  if (cfg.algorithm !== "weighted-field-bm25" && cfg.algorithm !== "overlap")
    throw new Error("Unsupported search algorithm");
  if (!Number.isInteger(cfg.version) || (cfg.version as number) < 1)
    throw new Error("Search version must be a positive integer");
  if (cfg.tokenizer !== "unicode-notation-v1") throw new Error("Unsupported tokenizer");
  const fields = cfg.fields;
  if (!fields || typeof fields !== "object" || !Object.keys(fields).length || Object.keys(fields).some(f => !SEARCH_FIELDS.has(f)))
    throw new Error("Invalid positive search fields");
  for (const [field, boost] of Object.entries(fields)) {
    if (!finite(boost) || boost <= 0) throw new Error(`Invalid boost: ${field}`);
  }
  for (const key of ["k1", "b"] as const) {
    if (!finite(cfg[key])) throw new Error(`Invalid parameter: ${key}`);
  }
  if ((cfg.k1 as number) <= 0 || !((cfg.b as number) >= 0 && (cfg.b as number) <= 1))
    throw new Error("BM25 parameters out of range");
  validateQueryAliases(cfg.query_aliases ?? {});
  return paths;
}

/** Alias expansion widens a lexical query; it never asserts that two phrases mean the same. */
export function validateQueryAliases(aliases: unknown): Record<string, string[]> {
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) throw new Error("query_aliases must be an object");
  const entries = Object.entries(aliases as Record<string, unknown>);
  if (entries.length > MAX_QUERY_ALIASES) throw new Error(`query_aliases exceeds ${MAX_QUERY_ALIASES} entries`);
  for (const [phrase, expansion] of entries) {
    if (!phrase.trim() || casefold(phrase) !== phrase)
      throw new Error(`query_aliases key must be a nonempty casefolded string: '${phrase}'`);
    if (!Array.isArray(expansion) || !expansion.length)
      throw new Error(`query_aliases value must be a nonempty list: ${phrase}`);
    for (const term of expansion) {
      if (typeof term !== "string" || !term.trim()) throw new Error(`query_aliases term must be a nonempty string: ${phrase}`);
    }
    if (expansion.includes(phrase)) throw new Error(`query_aliases key repeats itself in its expansion: ${phrase}`);
  }
  return aliases as Record<string, string[]>;
}

/** Storage placement is independent of topic routing: recipes/<slug>.json, knowledge/<kind>/<slug>.json. */
export function recordPath(record: Record<string, unknown>, collection: "recipes" | "knowledge"): string {
  const prefix = collection === "recipes" ? "recipe" : "knowledge";
  const rid = record.id;
  if (typeof rid !== "string" || !new RegExp(`^${prefix}\\.[a-z0-9]+(?:-[a-z0-9]+)*$`).test(rid))
    throw new Error(`Invalid ${prefix} ID: ${String(rid ?? "")}`);
  const slug = rid.split(".").slice(1).join(".");
  if (collection === "knowledge") {
    const kind = record.knowledge_kind;
    if (typeof kind !== "string" || !KNOWLEDGE_KINDS.has(kind)) throw new Error(`${rid}: invalid knowledge_kind`);
    return `knowledge/${kind}/${slug}.json`;
  }
  return `recipes/${slug}.json`;
}

/** The records one file holds: exactly one at layout 2, one or an array at layout 1. */
export function recordFile<T>(value: T, relativePath: string, collection: "recipes" | "knowledge", layoutVersion = 1): T[] {
  if (layoutVersion === 2) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${relativePath}: layout 2 requires one record object per file`);
    const expected = recordPath(value as Record<string, unknown>, collection);
    if (relativePath !== expected) throw new Error(`${relativePath}: expected record path ${expected}`);
    return [value];
  }
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.every(r => r && typeof r === "object" && !Array.isArray(r)))
    throw new Error(`${relativePath}: record object or array of objects required`);
  return rows as T[];
}

export const toPosix = (p: string) => p.split(sep).join("/");
