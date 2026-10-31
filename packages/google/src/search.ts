// SPDX-License-Identifier: Apache-2.0
/** Anonymous public search delegates SERP transport and parsing to the existing Rust owner. */
export interface GooglePublicSearchRequest {
  query: string;
  vertical?: "web";
  hl?: string;
  safe?: "active";
  start?: number;
  num?: number;
}

export interface GooglePublicSearchPage {
  query: string;
  organic: { title: string; url: string; snippet: string; position?: number }[];
  correctedQuery?: string;
  authenticated: false;
}

export interface GooglePublicSearchOptions {
  /** Qualified capability owner executable; defaults to aphrody on PATH. */
  executable?: string;
  /** Trusted owner runner injection for local fixtures; must honor cancellation. */
  run?: (args: string[], signal: AbortSignal) => Promise<string>;
}

const MAX_OUTPUT = 1024 * 1024;

async function runOwner(executable: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const child = Bun.spawn([executable, ...args], { stdout: "pipe", stderr: "ignore", signal });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let output = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_OUTPUT) throw new Error("Google search owner output exceeds limit");
      output += decoder.decode(next.value, { stream: true });
    }
    output += decoder.decode();
    if ((await child.exited) !== 0) throw new Error("Google search owner failed");
    return output;
  } finally {
    child.kill();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createGooglePublicSearch(options: GooglePublicSearchOptions = {}) {
  const executable = options.executable ?? "aphrody";
  if (!executable.trim() || executable.includes("\0")) throw new TypeError("Invalid Google owner executable");
  let active = 0;
  return async (request: GooglePublicSearchRequest, signal?: AbortSignal): Promise<GooglePublicSearchPage> => {
    const query = request.query?.trim();
    const hl = request.hl ?? "en";
    const start = request.start ?? 0;
    const num = request.num ?? 10;
    if (
      typeof query !== "string" ||
      !query ||
      new TextEncoder().encode(query).byteLength > 4096 ||
      Array.from(query).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new TypeError("Invalid search query");
    if (
      (request.vertical ?? "web") !== "web" ||
      (request.safe ?? "active") !== "active" ||
      !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(hl)
    )
      throw new TypeError("Public search requires web SafeSearch and a valid language");
    if (!Number.isInteger(start) || start < 0 || start > 1000 || !Number.isInteger(num) || num < 1 || num > 20)
      throw new TypeError("Invalid search bounds");
    signal?.throwIfAborted();
    if (active >= 4) throw new Error("Google search capacity exceeded");
    const combined = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
    const args = [
      "web",
      "search",
      "--json",
      "--no-auth",
      "--safe",
      "--transport",
      "fetch",
      "--domain",
      "google.com",
      "--hl",
      hl,
      "--gl",
      "US",
      "--num",
      String(num),
      "--start",
      String(start),
      "--",
      query,
    ];
    active++;
    try {
      const output = await (options.run ? options.run(args, combined) : runOwner(executable, args, combined));
      combined.throwIfAborted();
      if (new TextEncoder().encode(output).byteLength > MAX_OUTPUT) throw new Error();
      const payload: unknown = JSON.parse(output);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("query" in payload) ||
        payload.query !== query ||
        !("organic" in payload) ||
        !Array.isArray(payload.organic) ||
        ("authenticated" in payload && payload.authenticated !== false)
      )
        throw new Error();
      const organic: GooglePublicSearchPage["organic"] = [];
      for (const hit of payload.organic.slice(0, num)) {
        if (!hit || typeof hit.title !== "string" || typeof hit.url !== "string" || typeof hit.snippet !== "string")
          throw new Error();
        const url = new URL(hit.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
        organic.push({ title: hit.title, url: url.href, snippet: hit.snippet });
      }
      return {
        query,
        organic,
        authenticated: false,
        ...("correctedQuery" in payload && typeof payload.correctedQuery === "string"
          ? { correctedQuery: payload.correctedQuery }
          : {}),
      };
    } catch {
      signal?.throwIfAborted();
      throw new Error("Google anonymous search unavailable");
    } finally {
      active--;
    }
  };
}
