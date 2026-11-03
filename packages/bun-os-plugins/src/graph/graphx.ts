// SPDX-License-Identifier: Apache-2.0
// `bun:graphx` of the aphrody-labs/bun fork (src/js/bun/graphx.ts) on upstream Bun: snapshot JSON encoding,
// JSONL row streaming, a Redis snapshot cache, and Markdown/HTML reports over the BunPython registry.
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { scheduler } from "node:timers/promises";
type RedisClient = import("bun").RedisClient;
type Registry = { readonly db: Database };
type SnapshotIdentity = { repository: string; revision: string; sha256: string };
type JSONOptions = { maxRowBytes?: number; maxBytes?: number; maxRows?: number; signal?: AbortSignal };
type CacheOptions = { url?: string; prefix?: string; ttlSeconds?: number; maxBytes?: number; timeoutMs?: number };
type MarkdownOptions = { repository?: string; runId?: string; limit?: number };

function integer(value: number, name: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}

function identity(scope: SnapshotIdentity) {
  if (
    !scope ||
    typeof scope.repository !== "string" ||
    !scope.repository ||
    scope.repository.length > 2048 ||
    typeof scope.revision !== "string" ||
    !scope.revision ||
    scope.revision.length > 256 ||
    typeof scope.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(scope.sha256)
  )
    throw new TypeError("Invalid graph snapshot identity");
  return scope;
}

function encodeJSON(value: unknown, maxBytes = 1048576) {
  integer(maxBytes, "JSON byte limit", 1, 1073741824);
  let remaining = maxBytes;
  const ancestors = new Set<object>();
  const validate = (item: unknown, depth: number) => {
    if (depth > 64) throw new RangeError("JSON exceeds nesting limit");
    if (item === null) {
      remaining -= 4;
    } else if (typeof item === "string") {
      remaining -= Buffer.byteLength(item) + 2;
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Value is not lossless JSON");
      remaining -= String(item).length;
    } else if (typeof item === "boolean") {
      remaining -= item ? 4 : 5;
    } else if (typeof item === "object") {
      const prototype = Object.getPrototypeOf(item);
      if (
        (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) ||
        typeof (item as { toJSON?: unknown }).toJSON === "function"
      )
        throw new TypeError("Value is not lossless JSON");
      if (ancestors.has(item)) throw new TypeError("JSON contains a cycle");
      ancestors.add(item);
      remaining -= 2;
      if (Array.isArray(item)) {
        for (let index = 0; index < item.length; index++) {
          if (index) remaining--;
          validate(item[index], depth + 1);
        }
      } else {
        let index = 0;
        for (const key of Object.keys(item)) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (descriptor.get) throw new TypeError("JSON cannot read an accessor");
          remaining -= Buffer.byteLength(key) + 3 + (index++ ? 1 : 0);
          validate(descriptor.value, depth + 1);
        }
      }
      ancestors.delete(item);
    } else throw new TypeError("Value is not lossless JSON");
    if (remaining < 0) throw new RangeError("JSON exceeds byte limit");
  };
  validate(value, 0);
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Value cannot be encoded as JSON");
  if (Buffer.byteLength(encoded) > maxBytes) throw new RangeError("JSON exceeds byte limit");
  return encoded;
}

function decodeJSON(input: string | Uint8Array, maxBytes = 1048576): unknown {
  integer(maxBytes, "JSON byte limit", 1, 1073741824);
  const size = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
  if (size > maxBytes) throw new RangeError("JSON exceeds byte limit");
  return JSON.parse(typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input));
}

function* jsonChunks(rows: Iterable<unknown>, options: JSONOptions = {}): Generator<string> {
  const maxRowBytes = integer(options.maxRowBytes ?? 1048576, "JSON row byte limit", 1, 1073741824);
  const maxBytes = integer(options.maxBytes ?? 67108864, "JSON total byte limit", 2, Number.MAX_SAFE_INTEGER);
  const maxRows = integer(options.maxRows ?? 100000, "JSON row limit", 0, Number.MAX_SAFE_INTEGER);
  let bytes = 2;
  let count = 0;
  options.signal?.throwIfAborted();
  yield "[";
  for (const row of rows) {
    options.signal?.throwIfAborted();
    if (count === maxRows) throw new RangeError("JSON exceeds row limit");
    const text = encodeJSON(row, maxRowBytes);
    bytes += Buffer.byteLength(text) + (count ? 1 : 0);
    if (bytes > maxBytes) throw new RangeError("JSON exceeds total byte limit");
    yield (count++ ? "," : "") + text;
  }
  yield "]";
}

async function writeJSONRows(path: string, rows: Iterable<unknown>, options: JSONOptions = {}) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const writer = Bun.file(temporary).writer();
  let ended = false;
  let pending = 0;
  try {
    for (const chunk of jsonChunks(rows, options)) {
      const written = writer.write(chunk);
      if (typeof written !== "number") await written;
      pending += Buffer.byteLength(chunk);
      if (pending >= 65536) {
        await writer.flush();
        await scheduler.yield();
        pending = 0;
      }
    }
    options.signal?.throwIfAborted();
    await writer.end();
    ended = true;
    renameSync(temporary, target);
    return target;
  } catch (error) {
    if (!ended) {
      try {
        await writer.end();
      } catch {}
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}

class GraphRedisCache implements Disposable {
  readonly enabled: boolean;
  readonly prefix: string;
  readonly ttlSeconds: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  #url?: string;
  #client: RedisClient | null = null;
  #connecting: Promise<void> | null = null;
  #closed = false;

  constructor(options: CacheOptions = {}) {
    this.prefix = options.prefix ?? "bun:graph:v1";
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(this.prefix)) throw new TypeError("Invalid graph Redis prefix");
    this.ttlSeconds = integer(options.ttlSeconds ?? 300, "cache TTL", 1, 604800);
    this.maxBytes = integer(options.maxBytes ?? 1048576, "cache byte limit", 1, 67108864);
    this.timeoutMs = integer(options.timeoutMs ?? 1000, "cache timeout", 1, 30000);
    const configuredURL = options.url;
    this.enabled = configuredURL !== undefined;
    if (configuredURL !== undefined) {
      let url: URL;
      try {
        url = new URL(configuredURL);
      } catch {
        throw new TypeError("Invalid graph cache URL");
      }
      if (!["redis:", "rediss:", "valkey:", "valkeys:"].includes(url.protocol))
        throw new TypeError("Unsupported graph cache URL scheme");
      if (!url.hostname) throw new TypeError("Graph cache URL requires a hostname");
      this.#url = configuredURL;
    }
    Object.freeze(this);
  }

  snapshotPrefix(scope: SnapshotIdentity) {
    identity(scope);
    const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
    return `${this.prefix}:${hash(scope.repository)}:${hash(scope.revision)}:${scope.sha256.toLowerCase()}:`;
  }

  key(scope: SnapshotIdentity, query: string, parameters: readonly unknown[] = []) {
    if (typeof query !== "string" || !query || query.length > 262144 || !Array.isArray(parameters))
      throw new TypeError("Invalid graph cache query");
    const encoded = encodeJSON([query, parameters], this.maxBytes);
    return this.snapshotPrefix(scope) + new Bun.CryptoHasher("sha256").update(encoded).digest("hex");
  }

  async #request<T>(action: (client: RedisClient) => Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
    signal?.throwIfAborted();
    if (!this.enabled || this.#closed) return undefined;
    let client: RedisClient;
    try {
      client = this.#client ??= new Bun.RedisClient(this.#url, {
        connectionTimeout: this.timeoutMs,
        autoReconnect: false,
        enableOfflineQueue: false,
        maxRetries: 0,
      });
    } catch {
      return undefined;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Graph cache timed out")), this.timeoutMs);
        if (signal) {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
        }
      });
      const work = async () => {
        if (!client.connected) {
          const connecting = (this.#connecting ??= client.connect());
          try {
            await connecting;
          } finally {
            if (this.#connecting === connecting) this.#connecting = null;
          }
        }
        return await action(client);
      };
      return await Promise.race([work(), deadline]);
    } catch {
      client.close();
      if (this.#client === client) {
        this.#client = null;
        this.#connecting = null;
      }
      signal?.throwIfAborted();
      return undefined;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (abort) signal!.removeEventListener("abort", abort);
    }
  }

  async remember<T>(
    scope: SnapshotIdentity,
    query: string,
    parameters: readonly unknown[],
    read: () => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (typeof read !== "function") throw new TypeError("Graph cache requires an authoritative reader");
    identity(scope);
    signal?.throwIfAborted();
    const authoritative = async () => {
      signal?.throwIfAborted();
      const value = await read();
      signal?.throwIfAborted();
      return value;
    };
    if (!this.enabled || this.#closed) return await authoritative();
    let key: string;
    try {
      key = this.key(scope, query, parameters);
    } catch {
      return await authoritative();
    }
    const cached = await this.#request(client => client.get(key), signal);
    if (cached !== null && cached !== undefined) {
      try {
        return decodeJSON(cached, this.maxBytes) as T;
      } catch {}
    }
    signal?.throwIfAborted();
    const value = await authoritative();
    signal?.throwIfAborted();
    let encoded: string;
    try {
      encoded = encodeJSON(value, this.maxBytes);
    } catch {
      return value;
    }
    await this.#request(client => client.set(key, encoded, "EX", this.ttlSeconds), signal);
    return value;
  }

  async #clearPrefix(prefix: string, signal?: AbortSignal) {
    let cursor = "0";
    let removed = 0;
    for (let page = 0; page < 10000; page++) {
      const reply = await this.#request(client => client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 128), signal);
      if (!reply) return { removed, complete: !this.enabled };
      if (
        !Array.isArray(reply) ||
        typeof reply[0] !== "string" ||
        !Array.isArray(reply[1]) ||
        reply[1].some(key => typeof key !== "string")
      )
        return { removed, complete: false };
      cursor = reply[0];
      const keys = reply[1].filter(key => key.startsWith(prefix));
      for (let offset = 0; offset < keys.length; offset += 128) {
        const count = await this.#request(client => client.unlink(...keys.slice(offset, offset + 128)), signal);
        if (count === undefined) return { removed, complete: false };
        removed += count;
      }
      if (cursor === "0") return { removed, complete: true };
    }
    return { removed, complete: false };
  }

  invalidateSnapshot(scope: SnapshotIdentity, signal?: AbortSignal) {
    return this.#clearPrefix(this.snapshotPrefix(scope), signal);
  }

  clear(signal?: AbortSignal) {
    return this.#clearPrefix(`${this.prefix}:`, signal);
  }

  close() {
    this.#closed = true;
    this.#client?.close();
    this.#client = null;
    this.#connecting = null;
  }

  [Symbol.dispose]() {
    this.close();
  }
}

function markdownCell(value: unknown) {
  return Bun.escapeHTML(String(value ?? ""))
    .replaceAll("\\", "\\\\")
    .replace(/[|`*_{}[\]()#+.!>~]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");
}

async function markdown(registry: Registry, options: MarkdownOptions = {}) {
  const limit = integer(options.limit ?? 100, "Markdown row limit", 1, 1000);
  const repository = options.repository ?? null;
  const lines = ["# Bun graph", "", "## Sources", "", "| Repository | Kind | Revision |", "| --- | --- | --- |"];
  for (const row of registry.db
    .query<{ id: string; kind: string; revision: string | null }, [string | null, string | null, number]>(
      "SELECT id,kind,revision FROM repositories WHERE (? IS NULL OR id=?) ORDER BY id LIMIT ?",
    )
    .iterate(repository, repository, limit))
    lines.push(`| ${markdownCell(row.id)} | ${markdownCell(row.kind)} | ${markdownCell(row.revision)} |`);
  await scheduler.yield();
  lines.push(
    "",
    "## Graph snapshots",
    "",
    "| Repository | Producer | Revision | SHA256 | Nodes | Edges | Unresolved |",
    "| --- | --- | --- | --- | ---: | ---: | ---: |",
  );
  for (const row of registry.db
    .query<
      {
        repository_id: string;
        producer: string;
        revision: string | null;
        sha256: string;
        nodes: number | null;
        edges: number | null;
        unresolved: number | null;
      },
      [string | null, string | null, number]
    >(
      "SELECT repository_id,producer,revision,sha256,json_extract(metadata,'$.nodes') AS nodes,json_extract(metadata,'$.edges') AS edges,json_extract(metadata,'$.unresolved') AS unresolved FROM graph_snapshots WHERE (? IS NULL OR repository_id=?) ORDER BY repository_id,created_at,id LIMIT ?",
    )
    .iterate(repository, repository, limit))
    lines.push(
      `| ${[row.repository_id, row.producer, row.revision, row.sha256, row.nodes, row.edges, row.unresolved].map(markdownCell).join(" | ")} |`,
    );
  await scheduler.yield();
  lines.push(
    "",
    "## Source evidence",
    "",
    "| Symbol | Kind | File | Line | Provenance |",
    "| --- | --- | --- | ---: | --- |",
  );
  for (const row of registry.db
    .query<
      { label: string; kind: string; file: string; line: number | null; provenance: string },
      [string | null, string | null, number]
    >(
      "SELECT label,kind,file,line,provenance FROM nodes WHERE file IS NOT NULL AND (? IS NULL OR repository_id=?) ORDER BY repository_id,file,line,id LIMIT ?",
    )
    .iterate(repository, repository, limit))
    lines.push(`| ${[row.label, row.kind, row.file, row.line, row.provenance].map(markdownCell).join(" | ")} |`);
  await scheduler.yield();
  const runId =
    options.runId ??
    registry.db
      .query<{ run_id: string }, []>(
        "SELECT s.run_id FROM samples s JOIN runs r ON r.id=s.run_id WHERE r.status='passed' ORDER BY r.finished_at DESC,r.id DESC LIMIT 1",
      )
      .get()?.run_id;
  if (runId) {
    lines.push(
      "",
      "## Benchmark comparison",
      "",
      `Run: ${markdownCell(runId)}`,
      "",
      "| Kernel | Implementation | Samples | Median ms | P95 ms |",
      "| --- | --- | ---: | ---: | ---: |",
    );
    for (const row of registry.db
      .query<{ name: string; implementation: string; n: number; median: number; p95: number }, [string, number]>(
        `
      WITH ranked AS (
        SELECT name,implementation,milliseconds,
          row_number() OVER (PARTITION BY name,implementation ORDER BY milliseconds) AS rank,
          count(*) OVER (PARTITION BY name,implementation) AS total FROM samples WHERE run_id=?
      ) SELECT name,implementation,max(total) AS n,
        avg(CASE WHEN rank IN ((total+1)/2,(total+2)/2) THEN milliseconds END) AS median,
        max(CASE WHEN rank=(total*95+99)/100 THEN milliseconds END) AS p95
      FROM ranked GROUP BY name,implementation ORDER BY name,implementation LIMIT ?
    `,
      )
      .iterate(runId, limit))
      lines.push(`| ${[row.name, row.implementation, row.n, row.median, row.p95].map(markdownCell).join(" | ")} |`);
  }
  await scheduler.yield();
  lines.push(
    "",
    `Each section is limited to ${limit} rows. Graph producers retain their own extraction and unresolved-reference coverage.`,
    "",
  );
  return lines.join("\n");
}

function html(source: string, title = "Bun graph") {
  const body = Bun.markdown.render(
    source,
    {
      text: content => Bun.escapeHTML(content),
      heading: (children, meta) => `<h${meta.level}>${children}</h${meta.level}>`,
      paragraph: children => `<p>${children}</p>`,
      blockquote: children => `<blockquote>${children}</blockquote>`,
      code: children => `<pre><code>${children}</code></pre>`,
      codespan: children => `<code>${children}</code>`,
      strong: children => `<strong>${children}</strong>`,
      emphasis: children => `<em>${children}</em>`,
      strikethrough: children => `<del>${children}</del>`,
      hr: () => "<hr>",
      list: (children, meta) => (meta.ordered ? `<ol>${children}</ol>` : `<ul>${children}</ul>`),
      listItem: children => `<li>${children}</li>`,
      table: children => `<table>${children}</table>`,
      thead: children => `<thead>${children}</thead>`,
      tbody: children => `<tbody>${children}</tbody>`,
      tr: children => `<tr>${children}</tr>`,
      th: children => `<th>${children}</th>`,
      td: children => `<td>${children}</td>`,
      html: content => Bun.escapeHTML(content),
      link: children => children,
      image: () => "",
    },
    { noHtmlBlocks: true, noHtmlSpans: true, tagFilter: true, autolinks: false },
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>${Bun.escapeHTML(title)}</title></head><body><main>${body}</main></body></html>`;
}

export { GraphRedisCache, markdown, html, encodeJSON, decodeJSON, jsonChunks, writeJSONRows };
export default { GraphRedisCache, markdown, html, encodeJSON, decodeJSON, jsonChunks, writeJSONRows };
