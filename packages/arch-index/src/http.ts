// SPDX-License-Identifier: MIT
// Polite HTTP client for Arch infrastructure: descriptive User-Agent, conditional requests (ETag and
// If-Modified-Since), per-host spacing, Retry-After / RateLimit-* handling and bounded retries.

export const USER_AGENT = "bunos-archindex/1.0 (+https://github.com/aphrody-labs/bun-os)";

export interface ConditionalState {
  etag?: string | null;
  lastModified?: string | null;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    /** Milliseconds the server asked us to wait, when known. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type FetchOutcome =
  | { kind: "not-modified"; status: 304; url: string }
  | {
      kind: "ok";
      status: number;
      url: string;
      body: Uint8Array<ArrayBuffer>;
      etag: string | null;
      lastModified: string | null;
      headers: Headers;
    };

export interface ClientOptions {
  userAgent?: string;
  /** Injected fetch, default globalThis.fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Injected sleep so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum spacing between two requests to the same host. Default 250 ms. */
  minIntervalMs?: number;
  /** Per-host override of minIntervalMs. */
  hostIntervalMs?: Record<string, number>;
  /** Attempts after the first one for 429/5xx/network errors. Default 3. */
  maxRetries?: number;
  /** Longest Retry-After we are willing to sleep through; beyond it we throw. Default 120 s. */
  maxWaitMs?: number;
  timeoutMs?: number;
}

export interface ClientStats {
  requests: number;
  notModified: number;
  retries: number;
  bytes: number;
  rateLimited: number;
  byHost: Record<string, number>;
}

export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

export class ArchClient {
  readonly stats: ClientStats = { requests: 0, notModified: 0, retries: 0, bytes: 0, rateLimited: 0, byHost: {} };
  private readonly last = new Map<string, number>();
  private readonly gate = new Map<string, Promise<void>>();
  private readonly o: Required<Omit<ClientOptions, "hostIntervalMs">> & { hostIntervalMs: Record<string, number> };

  constructor(options: ClientOptions = {}) {
    this.o = {
      userAgent: options.userAgent ?? USER_AGENT,
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      sleep: options.sleep ?? (ms => Bun.sleep(ms)),
      now: options.now ?? Date.now,
      minIntervalMs: options.minIntervalMs ?? 250,
      hostIntervalMs: options.hostIntervalMs ?? {},
      maxRetries: options.maxRetries ?? 3,
      maxWaitMs: options.maxWaitMs ?? 120_000,
      timeoutMs: options.timeoutMs ?? 120_000,
    };
  }

  /** Serialise requests per host and keep the configured spacing. */
  private async pace(host: string): Promise<void> {
    const previous = this.gate.get(host) ?? Promise.resolve();
    const turn = previous.then(async () => {
      const interval = this.o.hostIntervalMs[host] ?? this.o.minIntervalMs;
      const wait = (this.last.get(host) ?? 0) + interval - this.o.now();
      if (wait > 0) await this.o.sleep(wait);
      this.last.set(host, this.o.now());
    });
    this.gate.set(
      host,
      turn.catch(() => {}),
    );
    await turn;
  }

  async get(url: string, options: { state?: ConditionalState; headers?: Record<string, string> } = {}): Promise<FetchOutcome> {
    const host = new URL(url).host;
    let attempt = 0;
    for (;;) {
      await this.pace(host);
      const headers: Record<string, string> = {
        "user-agent": this.o.userAgent,
        "accept-encoding": "gzip, br",
        ...options.headers,
      };
      if (options.state?.etag) headers["if-none-match"] = options.state.etag;
      if (options.state?.lastModified) headers["if-modified-since"] = options.state.lastModified;
      let response: Response | undefined;
      let failure: unknown;
      try {
        this.stats.requests++;
        this.stats.byHost[host] = (this.stats.byHost[host] ?? 0) + 1;
        response = await this.o.fetch(url, { headers, signal: AbortSignal.timeout(this.o.timeoutMs), redirect: "follow" });
      } catch (error) {
        failure = error;
      }
      if (response) {
        if (response.status === 304) {
          this.stats.notModified++;
          return { kind: "not-modified", status: 304, url };
        }
        if (response.ok) {
          const body = new Uint8Array(await response.arrayBuffer());
          this.stats.bytes += body.length;
          await this.honourRateLimit(response.headers);
          return {
            kind: "ok",
            status: response.status,
            url,
            body,
            etag: response.headers.get("etag"),
            lastModified: response.headers.get("last-modified"),
            headers: response.headers,
          };
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"), this.o.now());
        const retriable = response.status === 429 || response.status === 503 || response.status >= 500;
        if (response.status === 429) this.stats.rateLimited++;
        await response.body?.cancel().catch(() => {});
        if (!retriable || attempt >= this.o.maxRetries)
          throw new HttpError(`GET ${url} failed: HTTP ${response.status}`, response.status, url, retryAfter);
        if (retryAfter !== undefined && retryAfter > this.o.maxWaitMs)
          throw new HttpError(
            `GET ${url} rate limited: Retry-After ${Math.ceil(retryAfter / 1000)} s exceeds the ${Math.ceil(this.o.maxWaitMs / 1000)} s cap`,
            response.status,
            url,
            retryAfter,
          );
        attempt++;
        this.stats.retries++;
        await this.o.sleep(retryAfter ?? Math.min(30_000, 500 * 2 ** attempt));
        continue;
      }
      if (attempt >= this.o.maxRetries)
        throw new HttpError(`GET ${url} failed: ${failure instanceof Error ? failure.message : String(failure)}`, 0, url);
      attempt++;
      this.stats.retries++;
      await this.o.sleep(Math.min(30_000, 500 * 2 ** attempt));
    }
  }

  /** gitlab.archlinux.org announces its budget in RateLimit-Remaining / RateLimit-Reset (epoch seconds). */
  private async honourRateLimit(headers: Headers): Promise<void> {
    const remaining = Number(headers.get("ratelimit-remaining"));
    const reset = Number(headers.get("ratelimit-reset"));
    if (Number.isFinite(remaining) && remaining <= 2 && Number.isFinite(reset)) {
      const wait = reset * 1000 - this.o.now();
      if (wait > 0) await this.o.sleep(Math.min(wait, this.o.maxWaitMs));
    }
  }
}
