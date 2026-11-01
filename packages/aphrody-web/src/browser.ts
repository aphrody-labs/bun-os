// SPDX-License-Identifier: Apache-2.0

/** Fetch-based client for the private Aphrody REST RAG search route. */
export interface HttpSearchOptions {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface HttpSearchHit {
  title: string | null;
  url: string | null;
  corpus: string | null;
  snippet: string;
  match: string;
}

export interface HttpSearchReport {
  query: string;
  total_matches: number;
  limit: number;
  source: string;
  status: "ok" | "unavailable" | "query_required";
  reason?: string;
  results: HttpSearchHit[];
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
  const endpoint = new URL("/api/v1/rag/query", base.origin);
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
    Number.isInteger(report.total_matches) &&
    Number.isInteger(report.limit) &&
    typeof report.source === "string" &&
    (report.status === "ok" || report.status === "unavailable" || report.status === "query_required") &&
    (report.reason === undefined || typeof report.reason === "string") &&
    Array.isArray(report.results) &&
    report.results.every(isSearchHit)
  );
}

function isSearchHit(value: unknown): value is HttpSearchHit {
  if (typeof value !== "object" || value === null) return false;
  const hit = value as Partial<HttpSearchHit>;
  return (
    (hit.title === null || typeof hit.title === "string") &&
    (hit.url === null || typeof hit.url === "string") &&
    (hit.corpus === null || typeof hit.corpus === "string") &&
    typeof hit.snippet === "string" &&
    typeof hit.match === "string"
  );
}
