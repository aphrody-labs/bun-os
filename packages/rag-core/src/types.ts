// SPDX-License-Identifier: Apache-2.0
// Wire types of the call surface of crates/ai/rag-core/src/api.rs (the single source of truth).

/** Identifier preserved through fusion: integer or string. */
export type Id = number | string;

export type ChunkKind = "code" | "doc" | "prose" | "heading" | "config";
export type LengthUnit = "utf16" | "chars" | "bytes";
export type Language =
  | "rust"
  | "java_script"
  | "type_script"
  | "markdown"
  | "python"
  | "go"
  | "java"
  | "c_sharp"
  | "c"
  | "cpp"
  | "kotlin"
  | "swift"
  | "shell"
  | "toml"
  | "yaml"
  | "json"
  | "plain_text"
  | "unknown";

export interface ChunkOptions {
  /** `default` (aphrody) or `ts_parity` (legacy chunker parity). */
  profile?: "default" | "ts_parity";
  max_chars?: number;
  overlap_pct?: number;
  min_chars?: number;
  length_unit?: LengthUnit;
  cjk_sentence_breaks?: boolean;
}

export interface Chunk {
  ord: number;
  kind: ChunkKind;
  symbol: string | null;
  /** 1-based, inclusive. */
  start_line: number;
  end_line: number;
  text: string;
  /** BLAKE3 digest of `text`, lowercase hex. */
  hash: string;
}

export interface Sentence {
  text: string;
  start_line: number;
  end_line: number;
}

export interface Scored {
  id: Id;
  score: number;
}

export interface WeightedCandidate {
  id: Id;
  source_id?: string | null;
  kind?: string | null;
  score: number;
}

export interface SourceWeight {
  source_id: string;
  weight: number;
}

export interface QuotaRule {
  source_id: string;
  quota: number;
  min_score: number;
}

export interface MmrCandidate {
  id: Id;
  embedding: readonly number[];
  score: number;
}

export interface Hit {
  index: number;
  score: number;
}

export interface GoldCase {
  q: string;
  expect?: string[];
  expectUrl?: string[];
  expectTitle?: string[];
  tags?: string[];
}

export interface RetrievedHit {
  rowid?: number;
  kind?: string;
  title: string;
  url: string;
  snippet: string;
  sourceId?: string;
  lang?: string;
  score: number;
}

export interface CaseResult {
  case: GoldCase;
  rank: number;
  ndcg: number;
  top: { title: string; url: string; kind?: string }[];
  latency_ms: number;
  mode: string;
}

export interface Aggregate {
  cases: number;
  recall: Record<string, number>;
  mrr: number;
  ndcg: number;
}

export interface Report {
  schema_version: number;
  condition: string;
  overall: Aggregate;
  by_tag: Record<string, Aggregate>;
  cases: CaseResult[];
}

export interface MetricDelta {
  baseline: number;
  candidate: number;
  delta: number;
}

export interface Comparison {
  recall: Record<string, MetricDelta>;
  mrr: MetricDelta;
  ndcg: MetricDelta;
  by_tag_recall5_regressions: Record<string, MetricDelta>;
}

export type GateResult = { ok: true } | { ok: false; failure: { expr: string; actual: number; threshold: number } };

export interface Manifest {
  abi: number;
  crate: string;
  version: string;
  /** Whether the JS/TS chunker (oxc) is compiled into this build. */
  oxc: boolean;
  json: { name: string; summary: string }[];
  vec: { name: string; summary: string }[];
}
