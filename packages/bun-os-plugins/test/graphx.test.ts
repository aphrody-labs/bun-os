// SPDX-License-Identifier: Apache-2.0
// Ported from the aphrody-labs/bun fork (test/internal/graphx.test.ts): bun:graphx.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunPython } from "../src/graph/registry.ts";
import {
  GraphRedisCache,
  decodeJSON,
  encodeJSON,
  html,
  jsonChunks,
  markdown,
  writeJSONRows,
} from "../src/graph/graphx.ts";

/** `tempDir` of the Bun test harness: a fresh directory with files, removed on dispose. */
function tempDir(name: string, files: Record<string, string>) {
  const path = mkdtempSync(join(tmpdir(), `${name}-`));
  for (const [file, content] of Object.entries(files)) writeFileSync(join(path, file), content);
  return Object.assign(new String(path), { [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) });
}

const snapshot = { repository: "source:bun", revision: "a".repeat(40), sha256: "b".repeat(64) };

describe("graph tools", () => {
  test("cache scopes separate revisions, snapshots and bound query values", () => {
    using cache = new GraphRedisCache();
    const key = cache.key(snapshot, "search", ["Bun"]);
    expect(cache.enabled).toBe(false);
    expect(key).not.toBe(cache.key({ ...snapshot, repository: "source:cpython" }, "search", ["Bun"]));
    expect(key).not.toBe(cache.key({ ...snapshot, revision: "c".repeat(40) }, "search", ["Bun"]));
    expect(key).not.toBe(cache.key({ ...snapshot, sha256: "c".repeat(64) }, "search", ["Bun"]));
    expect(key).not.toBe(cache.key(snapshot, "search", ["bun"]));
    expect(key.startsWith(cache.snapshotPrefix(snapshot))).toBe(true);
    expect(() => cache.key({ ...snapshot, sha256: "not-a-snapshot" }, "search")).toThrow("snapshot identity");
  });

  test("invalid TTLs and prefixes cannot escape the cache namespace", () => {
    for (const ttlSeconds of [0, -1, 0.5, NaN, Infinity, 604801])
      expect(() => new GraphRedisCache({ ttlSeconds })).toThrow("TTL");
    for (const prefix of ["", "*", "scope?", "a[0]", "a\\b"])
      expect(() => new GraphRedisCache({ prefix })).toThrow("prefix");
    expect(() => new GraphRedisCache({ url: "https://example.test" })).toThrow("scheme");
    expect(() => new GraphRedisCache({ url: "secret credential invalid URL" })).toThrow("Invalid graph cache URL");
  });

  test("unconfigured cache preserves the authoritative result including bigint bindings", async () => {
    using cache = new GraphRedisCache();
    const value = { count: 1n };
    let reads = 0;
    const result = await cache.remember(snapshot, "count", [1n], () => {
      reads++;
      return value;
    });
    expect(result).toBe(value);
    expect(reads).toBe(1);
    expect(await cache.invalidateSnapshot(snapshot)).toEqual({ removed: 0, complete: true });
    expect(await cache.clear()).toEqual({ removed: 0, complete: true });
    const aborted = AbortSignal.abort(new Error("cancelled"));
    await expect(
      cache.remember(
        snapshot,
        "count",
        [],
        () => {
          reads++;
          return value;
        },
        aborted,
      ),
    ).rejects.toThrow("cancelled");
    expect(reads).toBe(1);
  });

  test("JSON streams bound row size, total bytes and iteration", () => {
    const rows = [{ text: "é" }, { text: "😀" }];
    expect(decodeJSON([...jsonChunks(rows)].join(""))).toEqual(rows);
    expect(() => [...jsonChunks(rows, { maxRows: 1 })]).toThrow("row limit");
    expect(() => [...jsonChunks(rows, { maxRowBytes: 3 })]).toThrow("byte limit");
    expect(() => [...jsonChunks(rows, { maxBytes: 5 })]).toThrow("total byte limit");
    expect(() => decodeJSON('"é"', 3)).toThrow("byte limit");
    expect(() => decodeJSON(new Uint8Array([0xff]))).toThrow();
    expect(() => encodeJSON({ missing: undefined })).toThrow("lossless JSON");
    expect(() => encodeJSON({ value: NaN })).toThrow("lossless JSON");
    expect(() => encodeJSON(new Date())).toThrow("lossless JSON");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => encodeJSON(cyclic)).toThrow("cycle");
  });

  test.concurrent("Redis failure falls back to SQLite without leaking connection credentials", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.end();
        },
        data() {},
      },
    });
    using cache = new GraphRedisCache({ url: `redis://user:protected@127.0.0.1:${server.port}`, timeoutMs: 1000 });
    try {
      const value = [{ authoritative: true }];
      expect(await cache.remember(snapshot, "prepared:SELECT", [], () => value)).toBe(value);
      expect(JSON.stringify(cache)).not.toContain("protected");
    } finally {
      server.stop(true);
    }
  });

  test.concurrent("failed JSON export leaves the prior artifact intact", async () => {
    using dir = tempDir("graph-json-export", { "result.json": "previous artifact" });
    const path = join(String(dir), "result.json");
    await expect(writeJSONRows(path, [{ value: "too large" }], { maxRowBytes: 2 })).rejects.toThrow("byte limit");
    expect(await Bun.file(path).text()).toBe("previous artifact");
    expect([...new Bun.Glob("*.tmp").scanSync(String(dir))]).toEqual([]);
    await writeJSONRows(path, [{ value: 1 }, { value: 2 }]);
    expect(await Bun.file(path).json()).toEqual([{ value: 1 }, { value: 2 }]);
  });

  test("Markdown preserves source provenance, computes medians and excludes raw sessions", async () => {
    using registry = new BunPython(":memory:");
    const repo = registry.repository("<script>alert(1)</script>|repo", "source", "fixture", "revision");
    await registry.importGraph(
      repo,
      {
        nodes: [{ id: "f", label: "<img src=x onerror=alert(2)>", source_file: "src/file.ts", source_location: "L4" }],
        edges: [],
      },
      "d".repeat(64),
    );
    const run = registry.startRun("benchmark", [], "fixture");
    for (let sample = 0; sample < 4; sample++) registry.sample(run, "kernel", "Bun / JSC", sample, sample + 1, "42");
    registry.finishRun(run, 0, "PRIVATE PROVIDER SESSION", "PRIVATE COOKIE");
    const report = await markdown(registry, { repository: repo, runId: run });
    expect(report).toContain("EXTRACTED");
    expect(report).toContain("src/file\\.ts");
    expect(report).toContain("| kernel | Bun / JSC | 4 | 2\\.5 | 4 |");
    expect(report).not.toContain("PRIVATE PROVIDER SESSION");
    expect(report).not.toContain("PRIVATE COOKIE");
    const rendered = html(report);
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("<img src=x");
    expect(rendered).toContain("&lt;script&gt;");
    expect(html("[unsafe](javascript:alert(1))\n\n<script>alert(2)</script>")).not.toContain('href="javascript:');
  });

  const redisUrl = process.env.BUN_GRAPH_TEST_REDIS_URL;
  if (redisUrl && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(redisUrl).hostname))
    throw new Error("Redis graph tests require a loopback endpoint");
  test.skipIf(!redisUrl)("configured native Redis cache invalidates only its own snapshot and prefix", async () => {
    using first = new GraphRedisCache({ url: redisUrl, prefix: `bun:graph:test:${crypto.randomUUID()}` });
    using other = new GraphRedisCache({ url: redisUrl, prefix: `bun:graph:test:${crypto.randomUUID()}` });
    let reads = 0;
    const read = () => ({ value: ++reads });
    try {
      expect(await first.remember(snapshot, "query", [], read)).toEqual({ value: 1 });
      expect(await first.remember(snapshot, "query", [], read)).toEqual({ value: 1 });
      expect(reads).toBe(1);
      expect(await other.remember(snapshot, "query", [], () => ({ value: 9 }))).toEqual({ value: 9 });
      expect((await first.invalidateSnapshot(snapshot)).complete).toBe(true);
      expect(await first.remember(snapshot, "query", [], read)).toEqual({ value: 2 });
      expect(await other.remember(snapshot, "query", [], () => ({ value: 10 }))).toEqual({ value: 9 });
    } finally {
      await Promise.all([first.clear(), other.clear()]);
    }
  });
});
