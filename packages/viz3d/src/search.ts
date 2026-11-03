// SPDX-License-Identifier: MIT
// Port of upstream scripts/search.py: lexical suggestions, not a semantic router or a probability of correctness.
import { type CatalogRecord, fieldText, fingerprint } from "./catalog.ts";
import { type Collection, COLLECTIONS, KNOWLEDGE_KINDS, type Manifest, type SearchConfig } from "./manifest-contract.ts";
import { casefold, escapeRegExp, normalize, tokens, WORD } from "./text.ts";

export type Algorithm = "weighted-field-bm25" | "overlap";

export interface SearchOptions {
  limit?: number;
  direction?: string | null;
  excludeIds?: readonly string[];
  algorithm?: Algorithm | null;
  collection?: Collection;
  kind?: string | null;
}

export interface SearchHit {
  id: string;
  revision: number;
  title: string;
  path: string;
  collection: "recipes" | "knowledge";
  kind: string;
  score: number;
  exact_id: boolean;
  exact_alias: boolean;
  matched_fields: string[];
  summary: string;
}

export interface SearchResult {
  status: "ambiguous" | "candidates" | "no-match";
  query: string;
  algorithm: Algorithm;
  index_version: number;
  expanded_terms: string[];
  hint: string;
  catalog_hash: string;
  results: SearchHit[];
  notice: string;
}

const pySorted = (values: Iterable<string>) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Alias phrases widen a lexical query; they never assert that two phrases mean the same. */
export function expand(query: string, cfg: SearchConfig): { terms: Set<string>; expanded: Set<string> } {
  const terms = new Set(tokens(query));
  const normalized = normalize(query);
  const added = new Set<string>();
  for (const [phrase, extra] of Object.entries(cfg.query_aliases ?? {})) {
    // Phrase match on word boundaries: 'foam' must not fire inside 'foamboard'.
    if (new RegExp(`(?<!${WORD})${escapeRegExp(phrase)}(?!${WORD})`, "u").test(normalized)) {
      for (const term of extra) for (const token of tokens(term)) added.add(token);
    }
  }
  return { terms: new Set([...terms, ...added]), expanded: new Set([...added].filter(t => !terms.has(t))) };
}

interface FieldCorpus {
  bags: Map<string, number>[];
  lengths: number[];
  average: number;
  df: Map<string, number>;
}

/** Corpus statistics per (record list, field); stable across structured filters, so cached per record array. */
const corpusCache = new WeakMap<CatalogRecord[], Map<string, FieldCorpus>>();

function corpusFor(active: CatalogRecord[], field: string): FieldCorpus {
  let fields = corpusCache.get(active);
  if (!fields) corpusCache.set(active, (fields = new Map()));
  let corpus = fields.get(field);
  if (corpus) return corpus;
  const bags = active.map(record => {
    const bag = new Map<string, number>();
    for (const token of tokens(fieldText(record, field))) bag.set(token, (bag.get(token) ?? 0) + 1);
    return bag;
  });
  const lengths = bags.map(bag => [...bag.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const bag of bags) for (const term of bag.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  corpus = { bags, lengths, average: lengths.reduce((a, b) => a + b, 0) / Math.max(active.length, 1), df };
  fields.set(field, corpus);
  return corpus;
}

const activeCache = new WeakMap<CatalogRecord[], Map<string, CatalogRecord[]>>();

function activeRecords(records: CatalogRecord[], collection: Collection): CatalogRecord[] {
  let byCollection = activeCache.get(records);
  if (!byCollection) activeCache.set(records, (byCollection = new Map()));
  let active = byCollection.get(collection);
  if (!active) {
    const prefix = collection === "recipes" ? "recipe." : "knowledge.";
    active = records.filter(r => r.status === "active" && (collection === "all" || r.id.startsWith(prefix)));
    byCollection.set(collection, active);
  }
  return active;
}

/** Python round(x, 6) for the magnitudes BM25 produces. */
const round6 = (x: number) => Number(x.toFixed(6));

export function search(query: string, manifest: Manifest, records: CatalogRecord[], options: SearchOptions = {}): SearchResult {
  const { limit = 5, direction = null, excludeIds = [], algorithm = null, collection = "recipes", kind = null } = options;
  if (!COLLECTIONS.has(collection) || (kind !== null && !KNOWLEDGE_KINDS.has(kind)))
    throw new Error("Unknown collection or knowledge kind");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be between 1 and 20");
  const cfg = manifest.search;
  const method = algorithm ?? cfg.algorithm;
  if (method !== "weighted-field-bm25" && method !== "overlap") throw new Error("Unknown search algorithm");
  const { terms, expanded } = expand(query, cfg);
  const active = activeRecords(records, collection);
  const n = active.length;
  const excluded = new Set(excludeIds);
  const queryTokens = tokens(query).join("\u0000");
  const exactQuery = casefold(query.trim());
  const results: SearchHit[] = [];
  const corpora = Object.keys(cfg.fields).map(field => [field, corpusFor(active, field)] as const);
  active.forEach((record, i) => {
    if (excluded.has(record.id) || (direction && !(record.direction_ids ?? []).includes(direction))) return;
    if (kind && record.knowledge_kind !== kind) return;
    const exact = exactQuery === casefold(record.id);
    const alias = (record.aliases?.en ?? []).some(a => tokens(a).join("\u0000") === queryTokens);
    let score = 0;
    const matches: string[] = [];
    for (const [field, corpus] of corpora) {
      const boost = cfg.fields[field]!;
      const bag = corpus.bags[i]!;
      const hit = [...terms].filter(t => bag.has(t));
      if (!hit.length) continue;
      matches.push(field);
      if (method === "overlap") {
        score += boost * hit.length;
        continue;
      }
      const length = corpus.lengths[i]!;
      for (const term of hit) {
        const df = corpus.df.get(term) ?? 0;
        // Positive smoothed IDF; weighted sum of independently normalized fields.
        const idf = Math.log1p((n - df + 0.5) / (df + 0.5));
        const tf = bag.get(term)!;
        const denominator = tf + cfg.k1 * (1 - cfg.b + (cfg.b * length) / Math.max(corpus.average, 1));
        score += (boost * idf * tf * (cfg.k1 + 1)) / denominator;
      }
    }
    if (terms.size && (score > 0 || exact || alias)) {
      results.push({
        id: record.id,
        revision: record.revision,
        title: record.title.en,
        path: record._path,
        collection: record.id.startsWith("knowledge.") ? "knowledge" : "recipes",
        kind: record.knowledge_kind ?? "recipe",
        score: round6(score),
        exact_id: exact,
        exact_alias: alias,
        matched_fields: matches,
        summary: record.summary,
      });
    }
  });
  results.sort(
    (a, b) =>
      Number(b.exact_id) - Number(a.exact_id) ||
      Number(b.exact_alias) - Number(a.exact_alias) ||
      b.score - a.score ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const ambiguous = results.filter(r => r.exact_alias).length > 1;
  const hint = !results.length
    ? "no match: describe the look in plain words; the catalog is not a menu"
    : results.length < 3
      ? "few candidates: rephrase in plain words, or narrow with --kind style-profile / --kind lighting-profile"
      : "";
  return {
    status: ambiguous ? "ambiguous" : results.length ? "candidates" : "no-match",
    query,
    algorithm: method,
    index_version: cfg.version,
    expanded_terms: pySorted(expanded),
    hint,
    catalog_hash: fingerprint(manifest, records),
    results: results.slice(0, limit),
    notice:
      "Lexical candidates only. Interpret negation and intent before choosing. " +
      "Scores are not probabilities; no match does not limit creative capability.",
  };
}
