export interface CrawlOptions {
  urls: string[];
  allowedDomains?: string[];
  maxDepth?: number;
  maxRequests?: number;
  concurrency?: number;
  perHostDelay?: number;
  maxPerHost?: number;
  maxRetries?: number;
  obeyRobots?: boolean;
  sitemaps?: boolean;
  sqlite?: string;
  browser?: "native" | "playwright";
}

export interface CrawlPage {
  url: string;
  depth: number;
  status: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  markdown: string;
  text: string;
  blocks: unknown[];
  wordCount: number;
  duplicate: boolean;
  discoveredLinks: number;
}

export interface CrawlReport {
  attempts: number;
  pagesFound: number;
  pages: CrawlPage[];
  exactDuplicates: number;
  nearDuplicates: number;
  errors: unknown[];
  errorsFound: number;
  errorsTruncated: boolean;
  robotsFetched: number;
  robotsBlocked: number;
  sitemapsFetched: number;
  sitemapUrlsEnqueued: number;
  frontier: { pending: number; locked: number; done: number; failed: number };
}

export interface ClientOptions {
  /** Defaults to APHRODY_BIN, then `aphrody` from PATH. */
  binary?: string;
  /** Cancels the CLI subprocess when the operation is no longer needed. */
  signal?: AbortSignal;
}

export type SearchMode = "lexical" | "vector" | "hybrid" | "hybrid-rerank";

export interface SearchOptions {
  query: string;
  limit?: number;
  mode?: SearchMode;
  lang?: string;
  entity?: string;
  kind?: string;
  /** Explicit local RAG SQLite database. Omit to use the configured Aphrody profile. */
  database?: string;
}

export interface SearchChunk {
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
}

export interface SearchHit {
  chunk: SearchChunk;
  score: number;
  channel: "lexical" | "vector" | "rrf" | "rerank" | string;
}

export interface SearchReport {
  query: string;
  hits: SearchHit[];
  mode_served: "lexical" | "vector" | "hybrid";
  fallback_reason: string | null;
  elapsed_ms: number;
  total_candidates: number;
}

export class AphrodyWebError extends Error {
  readonly exitCode: number;
  readonly stderr: string;

  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = "AphrodyWebError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

function assertInteger(name: string, value: number | undefined, min: number, max: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
}

function argumentsFor(options: CrawlOptions): string[] {
  if (options.urls.length < 1 || options.urls.length > 100) {
    throw new RangeError("urls must contain between 1 and 100 HTTP(S) URLs");
  }
  for (const raw of options.urls) {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError(`unsupported URL protocol: ${url.protocol}`);
    }
    if (url.username || url.password) throw new TypeError("seed URLs must not contain credentials");
  }
  assertInteger("maxDepth", options.maxDepth, 0, 20);
  assertInteger("maxRequests", options.maxRequests, 1, 100_000);
  assertInteger("concurrency", options.concurrency, 1, 256);
  assertInteger("perHostDelay", options.perHostDelay, 0, 60_000);
  assertInteger("maxPerHost", options.maxPerHost, 1, 256);
  assertInteger("maxRetries", options.maxRetries, 0, 100);

  const args = ["web", "crawl", ...options.urls];
  const values: Array<[string, string | number | undefined]> = [
    ["--allowed-domains", options.allowedDomains?.join(",")],
    ["--max-depth", options.maxDepth],
    ["--max-requests", options.maxRequests],
    ["--concurrency", options.concurrency],
    ["--per-host-delay", options.perHostDelay],
    ["--max-per-host", options.maxPerHost],
    ["--max-retries", options.maxRetries],
    ["--sqlite", options.sqlite],
    ["--browser", options.browser],
  ];
  for (const [flag, value] of values) {
    if (value !== undefined) args.push(flag, String(value));
  }
  if (options.obeyRobots) args.push("--obey-robots");
  if (options.sitemaps) args.push("--sitemaps");
  args.push("--json");
  return args;
}

/** Run Aphrody's bounded crawl CLI and parse its JSON report. No shell is used. */
export async function crawl(options: CrawlOptions, client: ClientOptions = {}): Promise<CrawlReport> {
  throwIfAborted(client.signal);
  const binary = client.binary ?? Bun.env.APHRODY_BIN ?? "aphrody";
  const child = Bun.spawn([binary, ...argumentsFor(options)], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: client.signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  throwIfAborted(client.signal);
  if (exitCode !== 0) {
    throw new AphrodyWebError(stderr.trim() || `aphrody exited with code ${exitCode}`, exitCode, stderr);
  }
  try {
    return JSON.parse(stdout) as CrawlReport;
  } catch {
    throw new AphrodyWebError("aphrody returned invalid JSON", exitCode, stderr);
  }
}

/**
 * Search the configured Aphrody local RAG index. Web pages become searchable
 * after they are ingested with `aphrody rag web-ingest` or `web crawl-index`.
 * This Bun adapter invokes the shared Rust CLI without a shell.
 */
export async function searchIndex(options: SearchOptions, client: ClientOptions = {}): Promise<SearchReport> {
  throwIfAborted(client.signal);
  const query = options.query.trim();
  if (!query) throw new TypeError("query must not be empty");
  assertInteger("limit", options.limit, 1, 100);
  const mode = options.mode ?? "hybrid";
  if (!["lexical", "vector", "hybrid", "hybrid-rerank"].includes(mode)) {
    throw new TypeError(`unsupported search mode: ${mode}`);
  }

  const args = ["rag"];
  if (options.database !== undefined) {
    if (!options.database.trim()) throw new TypeError("database must not be empty");
    args.push("--db", options.database);
  }
  args.push("search", query, "--limit", String(options.limit ?? 5), "--mode", mode);
  for (const [flag, value] of [
    ["--lang", options.lang],
    ["--entity", options.entity],
    ["--kind", options.kind],
  ] as const) {
    if (value !== undefined) args.push(flag, value);
  }

  const binary = client.binary ?? Bun.env.APHRODY_BIN ?? "aphrody";
  const child = Bun.spawn([binary, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: client.signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  throwIfAborted(client.signal);
  if (exitCode !== 0) {
    throw new AphrodyWebError(stderr.trim() || `aphrody exited with code ${exitCode}`, exitCode, stderr);
  }
  try {
    const result: unknown = JSON.parse(stdout);
    if (!isSearchReport(result)) throw new TypeError("unexpected search response shape");
    return result;
  } catch (error) {
    throw new AphrodyWebError(
      error instanceof Error
        ? `aphrody returned invalid search JSON: ${error.message}`
        : "aphrody returned invalid search JSON",
      exitCode,
      stderr,
    );
  }
}

function isSearchReport(value: unknown): value is SearchReport {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<SearchReport>;
  return (
    typeof result.query === "string" &&
    Array.isArray(result.hits) &&
    result.hits.every(isSearchHit) &&
    (result.mode_served === "lexical" || result.mode_served === "vector" || result.mode_served === "hybrid") &&
    (result.fallback_reason === null || typeof result.fallback_reason === "string") &&
    Number.isFinite(result.elapsed_ms) &&
    Number.isFinite(result.total_candidates)
  );
}

function isSearchHit(value: unknown): value is SearchHit {
  if (typeof value !== "object" || value === null) return false;
  const hit = value as Partial<SearchHit>;
  if (!Number.isFinite(hit.score) || typeof hit.channel !== "string") return false;
  if (typeof hit.chunk !== "object" || hit.chunk === null) return false;
  const chunk = hit.chunk as Partial<SearchChunk>;
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }
}
