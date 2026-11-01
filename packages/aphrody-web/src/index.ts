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

function assertInteger(
  name: string,
  value: number | undefined,
  min: number,
  max: number,
): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < min || value > max)
  ) {
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
    if (url.username || url.password)
      throw new TypeError("seed URLs must not contain credentials");
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
export async function crawl(
  options: CrawlOptions,
  client: ClientOptions = {},
): Promise<CrawlReport> {
  const binary = client.binary ?? Bun.env.APHRODY_BIN ?? "aphrody";
  const child = Bun.spawn([binary, ...argumentsFor(options)], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout.text(),
    child.stderr.text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new AphrodyWebError(
      stderr.trim() || `aphrody exited with code ${exitCode}`,
      exitCode,
      stderr,
    );
  }
  try {
    return JSON.parse(stdout) as CrawlReport;
  } catch {
    throw new AphrodyWebError(
      "aphrody returned invalid JSON",
      exitCode,
      stderr,
    );
  }
}
