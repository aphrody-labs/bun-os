// SPDX-License-Identifier: Apache-2.0

/** Fetch-based client for the private Aphrody REST RAG search route. */
export interface HttpSearchOptions {
  query: string;
  limit?: number;
  pathPrefix?: string;
  signal?: AbortSignal;
}

export interface HttpSearchHit {
  chunk: {
    id: number;
    doc_id: number;
    path: string;
    chunk_index: number;
    heading: string | null;
    symbol: string | null;
    content: string;
    start_line: number;
    end_line: number;
    token_count: number;
  };
  score: number;
  channel: string;
}

export interface HttpSearchReport {
  query: string;
  hits: HttpSearchHit[];
  mode_served: "lexical" | "vector" | "hybrid";
  fallback_reason: string | null;
  elapsed_ms: number;
  total_candidates: number;
}

export interface HttpSearchClientOptions {
  /** Origin serving Aphrody MCP's REST routes, for example https://search.example. */
  baseUrl: string | URL;
  /** Defaults to the platform Fetch API; inject a compatible implementation in other runtimes. */
  fetch?: typeof globalThis.fetch;
}

export class AphrodyWebHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AphrodyWebHttpError";
    this.status = status;
  }
}

/**
 * Create a browser and runtime-neutral client for Aphrody's REST keyword
 * search. The gateway is private by default; browser callers need a same-origin
 * deployment or an explicitly configured CORS gateway.
 */
export function createHttpSearchClient(options: HttpSearchClientOptions) {
  const base = new URL(options.baseUrl);
  if (!((base.protocol === "https:" || base.protocol === "http:") && !base.username && !base.password)) {
    throw new TypeError("baseUrl must be an HTTP(S) origin without credentials");
  }
  const endpoint = new URL("/api/v1/rag/search", base.origin);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new TypeError("a Fetch API implementation is required");

  return {
    async search(request: HttpSearchOptions): Promise<HttpSearchReport> {
      const query = request.query.trim();
      if (!query) throw new TypeError("query must not be empty");
      const limit = request.limit ?? 5;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new RangeError("limit must be an integer from 1 to 20");
      }

      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(limit));
      if (request.pathPrefix !== undefined) url.searchParams.set("path_prefix", request.pathPrefix);
      const response = await fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        signal: request.signal,
      });
      if (!response.ok)
        throw new AphrodyWebHttpError(`Aphrody search returned HTTP ${response.status}`, response.status);
      const payload: unknown = await response.json();
      if (!isSearchReport(payload))
        throw new AphrodyWebHttpError("Aphrody search returned an invalid response", response.status);
      return payload;
    },
  };
}

function isSearchReport(value: unknown): value is HttpSearchReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Partial<HttpSearchReport>;
  return (
    typeof report.query === "string" &&
    Array.isArray(report.hits) &&
    report.hits.every(isSearchHit) &&
    (report.mode_served === "lexical" || report.mode_served === "vector" || report.mode_served === "hybrid") &&
    (report.fallback_reason === null || typeof report.fallback_reason === "string") &&
    Number.isFinite(report.elapsed_ms) &&
    Number.isInteger(report.total_candidates)
  );
}

function isSearchHit(value: unknown): value is HttpSearchHit {
  if (typeof value !== "object" || value === null) return false;
  const hit = value as Partial<HttpSearchHit>;
  return (
    Number.isFinite(hit.score) &&
    typeof hit.channel === "string" &&
    typeof hit.chunk === "object" &&
    hit.chunk !== null &&
    isSearchChunk(hit.chunk)
  );
}

function isSearchChunk(value: unknown): value is HttpSearchHit["chunk"] {
  if (typeof value !== "object" || value === null) return false;
  const chunk = value as Partial<HttpSearchHit["chunk"]>;
  return (
    Number.isInteger(chunk.id) &&
    Number.isInteger(chunk.doc_id) &&
    typeof chunk.path === "string" &&
    Number.isInteger(chunk.chunk_index) &&
    (chunk.heading === null || typeof chunk.heading === "string") &&
    (chunk.symbol === null || typeof chunk.symbol === "string") &&
    typeof chunk.content === "string" &&
    Number.isInteger(chunk.start_line) &&
    Number.isInteger(chunk.end_line) &&
    Number.isInteger(chunk.token_count)
  );
}
