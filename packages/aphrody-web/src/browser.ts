// SPDX-License-Identifier: Apache-2.0

/** Fetch-based client for Aphrody's local-index REST search route. */
export interface HttpSearchOptions {
  query: string;
  limit?: number;
  pathPrefix?: string;
  mode?: RetrievalMode;
  signal?: AbortSignal;
}

export type RetrievalMode = "lexical" | "vector" | "hybrid";

export type WebSearchCategory = "general" | "news" | "science" | "it" | "images" | "videos";
export type WebSearchTimeRange = "day" | "month" | "year";

export interface WebSearchOptions {
  query: string;
  limit?: number;
  categories?: WebSearchCategory[];
  language?: string;
  page?: number;
  timeRange?: WebSearchTimeRange;
  safeSearch?: 0 | 1 | 2;
  engines?: string[];
  disabledEngines?: string[];
  signal?: AbortSignal;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  engine: string | null;
  category: string | null;
  publishedAt: string | null;
  engines: string[];
  score: number | null;
  thumbnail: string | null;
  template: string | null;
  metadata: Record<string, unknown>;
}

export interface WebSearchReport {
  query: string;
  results: WebSearchResultItem[];
  provider: "searxng";
  page: number;
  totalResults: number;
  answers: string[];
  corrections: string[];
  suggestions: string[];
  unresponsiveEngines: string[];
  infoboxes: Array<Record<string, unknown>>;
}

export interface SearxngSearchOptions {
  /** Base URL of the self-hosted Aphrody web-search REST endpoint. */
  baseUrl: string | URL;
  /** Defaults to the platform Fetch API; inject a compatible implementation in other runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Total request timeout. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** Server-side gateway bearer. Never include this in a browser bundle. */
  bearerToken?: string;
}

export class AphrodyWebSearchError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AphrodyWebSearchError";
    this.status = status;
  }
}

interface SearxngWireResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  engine?: unknown;
  category?: unknown;
  publishedDate?: unknown;
  engines?: unknown;
  score?: unknown;
  thumbnail?: unknown;
  template?: unknown;
}

interface SearxngWireResponse {
  results?: unknown;
  totalResults?: unknown;
  answers?: unknown;
  corrections?: unknown;
  suggestions?: unknown;
  unresponsive_engines?: unknown;
  infoboxes?: unknown;
}

/** Create a typed web-search client backed by Aphrody's REST adapter. */
export function createSearxngSearchClient(options: SearxngSearchOptions) {
  const base = new URL(options.baseUrl);
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new TypeError("baseUrl must be an HTTP(S) SearXNG origin or path without credentials, query, or fragment");
  }
  const endpoint = new URL("/api/v1/web/search", base.origin);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new TypeError("a Fetch API implementation is required");
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError("timeoutMs must be an integer from 1 to 120000");
  }
  if (options.bearerToken !== undefined && !options.bearerToken.trim()) {
    throw new TypeError("bearerToken must not be empty when provided");
  }
  if (
    options.bearerToken &&
    base.protocol !== "https:" &&
    base.hostname !== "localhost" &&
    base.hostname !== "127.0.0.1" &&
    base.hostname !== "[::1]"
  ) {
    throw new TypeError("bearerToken requires HTTPS except for loopback services");
  }

  return {
    async search(request: WebSearchOptions): Promise<WebSearchReport> {
      const query = request.query.trim();
      if (!query || query.length > 4096) throw new TypeError("query must contain 1 to 4096 characters");
      const limit = request.limit ?? 10;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new RangeError("limit must be an integer from 1 to 50");
      }
      const page = request.page ?? 1;
      if (!Number.isInteger(page) || page < 1 || page > 100) {
        throw new RangeError("page must be an integer from 1 to 100");
      }
      if (request.language !== undefined && !/^(all|[a-z]{2,3})(-[A-Z]{2})?$/.test(request.language)) {
        throw new TypeError("language must be a language code such as en or fr-FR");
      }
      if (request.timeRange !== undefined && !["day", "month", "year"].includes(request.timeRange)) {
        throw new TypeError("timeRange must be day, month, or year");
      }
      if (request.safeSearch !== undefined && ![0, 1, 2].includes(request.safeSearch)) {
        throw new TypeError("safeSearch must be 0, 1, or 2");
      }
      if (
        request.categories?.some(
          category => !["general", "news", "science", "it", "images", "videos"].includes(category),
        )
      ) {
        throw new TypeError("unsupported SearXNG category");
      }

      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("page", String(page));
      if (request.categories?.length) url.searchParams.set("categories", request.categories.join(","));
      if (request.language) url.searchParams.set("language", request.language);
      if (request.timeRange) url.searchParams.set("time_range", request.timeRange);
      if (request.safeSearch !== undefined) url.searchParams.set("safesearch", String(request.safeSearch));
      if (request.engines?.length) url.searchParams.set("engines", request.engines.join(","));
      if (request.disabledEngines?.length) url.searchParams.set("disabled_engines", request.disabledEngines.join(","));

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new DOMException("Search timed out", "TimeoutError")),
        timeoutMs,
      );
      const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
      try {
        const headers = new Headers({ accept: "application/json" });
        if (options.bearerToken) headers.set("authorization", `Bearer ${options.bearerToken}`);
        const response = await fetcher(url, {
          headers,
          credentials: options.bearerToken ? "same-origin" : "omit",
          ...(options.bearerToken ? { redirect: "error" as const } : {}),
          signal,
        });
        if (!response.ok)
          throw new AphrodyWebSearchError(`Aphrody web search returned HTTP ${response.status}`, response.status);
        let payload: SearxngWireResponse;
        try {
          payload = (await response.json()) as SearxngWireResponse;
        } catch {
          throw new AphrodyWebSearchError("Aphrody web search returned invalid JSON", response.status);
        }
        if (!Array.isArray(payload.results)) {
          throw new AphrodyWebSearchError("Aphrody web search returned an invalid response shape", response.status);
        }
        const results = payload.results
          .filter((item): item is SearxngWireResult => typeof item === "object" && item !== null)
          .flatMap(item => {
            if (typeof item.title !== "string" || typeof item.url !== "string") return [];
            let resultUrl: URL;
            try {
              resultUrl = new URL(item.url);
            } catch {
              return [];
            }
            if (resultUrl.protocol !== "https:" && resultUrl.protocol !== "http:") return [];
            return [
              {
                title: item.title,
                url: resultUrl.href,
                snippet: typeof item.content === "string" ? item.content : "",
                engine: typeof item.engine === "string" ? item.engine : null,
                category: typeof item.category === "string" ? item.category : null,
                publishedAt: typeof item.publishedDate === "string" ? item.publishedDate : null,
                engines: stringArray(item.engines),
                score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : null,
                thumbnail: safeHttpUrl(item.thumbnail),
                template: typeof item.template === "string" ? item.template : null,
                metadata: item as Record<string, unknown>,
              },
            ];
          })
          .slice(0, limit);
        return {
          query,
          results,
          provider: "searxng",
          page,
          totalResults: typeof payload.totalResults === "number" ? payload.totalResults : results.length,
          answers: stringArray(payload.answers),
          corrections: stringArray(payload.corrections),
          suggestions: stringArray(payload.suggestions),
          unresponsiveEngines: stringArray(payload.unresponsive_engines),
          infoboxes: objectArray(payload.infoboxes),
        };
      } catch (error) {
        if (request.signal?.aborted)
          throw request.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof AphrodyWebSearchError) throw error;
        throw new AphrodyWebSearchError(error instanceof Error ? error.message : "Aphrody web search failed");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
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
  mode_served: RetrievalMode;
  fallback_reason: string | null;
  elapsed_ms: number;
  total_candidates: number;
}

export interface HttpSearchClientOptions {
  /** Origin serving Aphrody's RAG REST route, for example https://search.example. */
  baseUrl: string | URL;
  /** Defaults to the platform Fetch API; inject a compatible implementation in other runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Optional server-side bearer for a trusted gateway. Do not set this in browser bundles. */
  bearerToken?: string;
}

export class AphrodyWebHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AphrodyWebHttpError";
    this.status = status;
    this.code = code;
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
  if (options.bearerToken !== undefined && !options.bearerToken.trim()) {
    throw new TypeError("bearerToken must not be empty when provided");
  }
  if (
    options.bearerToken &&
    base.protocol !== "https:" &&
    base.hostname !== "localhost" &&
    base.hostname !== "127.0.0.1" &&
    base.hostname !== "[::1]"
  ) {
    throw new TypeError("bearerToken requires HTTPS except for loopback services");
  }

  return {
    async search(request: HttpSearchOptions): Promise<HttpSearchReport> {
      const query = request.query.trim();
      if (!query) throw new TypeError("query must not be empty");
      const limit = request.limit ?? 8;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new RangeError("limit must be an integer from 1 to 50");
      }
      const mode = request.mode ?? "hybrid";
      if (mode !== "lexical" && mode !== "vector" && mode !== "hybrid") {
        throw new TypeError(`unsupported retrieval mode: ${String(mode)}`);
      }

      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("mode", mode);
      if (request.pathPrefix !== undefined) url.searchParams.set("path_prefix", request.pathPrefix);
      const headers = new Headers({ accept: "application/json" });
      if (options.bearerToken) headers.set("authorization", `Bearer ${options.bearerToken}`);
      const guardedFetch = options.bearerToken
        ? (input: RequestInfo | URL, init?: RequestInit) => fetcher(input, { ...init, redirect: "error" })
        : fetcher;
      const response = await guardedFetch(url, {
        method: "GET",
        headers,
        credentials: options.bearerToken ? "same-origin" : "omit",
        signal: request.signal,
      });
      if (!response.ok) {
        let message = `Aphrody search returned HTTP ${response.status}`;
        let code: string | undefined;
        try {
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null) {
            const error = (body as { error?: unknown }).error;
            if (typeof error === "string") message = error;
            else if (typeof error === "object" && error !== null) {
              const detail = error as { message?: unknown; code?: unknown };
              if (typeof detail.message === "string") message = detail.message;
              if (typeof detail.code === "string") code = detail.code;
            }
          }
        } catch {
          // Keep the status-based error when the server did not return JSON.
        }
        throw new AphrodyWebHttpError(message, response.status, code);
      }
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
