// SPDX-License-Identifier: Apache-2.0
// Ported from the aphrody-labs/bun fork (test/internal/pyjs.test.ts): the bun:graph BunPython registry.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduler } from "node:timers/promises";
import { BunPython } from "../src/graph/registry.ts";

/** `tempDir` of the Bun test harness: a fresh directory with files, removed on dispose. */
function tempDir(name: string, files: Record<string, string>) {
  const path = mkdtempSync(join(tmpdir(), `${name}-`));
  for (const [file, content] of Object.entries(files)) writeFileSync(join(path, file), content);
  return Object.assign(new String(path), { [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) });
}

test("benchmark imports roll back invalid batches and enforce run ownership", () => {
  using registry = new BunPython(":memory:");
  const run = registry.startRun("benchmark", ["bun", "--version"], "/work");
  expect(() =>
    registry.db.transaction(() => {
      registry.sample(run, "case", "Bun", 0, 1);
      registry.sample(run, "case", "Bun", 0, 2);
    })(),
  ).toThrow();
  expect(registry.counts().samples).toBe(0);
  expect(() => registry.sample("missing", "case", "Bun", 0, 1)).toThrow();
  for (const duration of [NaN, Infinity, -1]) expect(() => registry.sample(run, "case", "Bun", 0, duration)).toThrow();
  registry.sample(run, "case", "Bun", 0, 1);
  registry.finishRun(run, 37, "child output", "child error");
  expect(registry.db.query("SELECT status,exit_code,stdout,stderr FROM runs").get()).toEqual({
    status: "failed",
    exit_code: 37,
    stdout: "child output",
    stderr: "child error",
  });
  expect(() => registry.finishRun(run, 0)).toThrow("already finished");
});

test("graph snapshots isolate changed symbols and retain unresolved references", async () => {
  using registry = new BunPython(":memory:");
  const repository = registry.repository("bun", "source", "/work", "first", { dirty: "owned" }, "main");
  registry.repository("bun", "source", "/work");
  expect(registry.db.query("SELECT revision,branch,metadata FROM repositories").get()).toEqual({
    revision: "first",
    branch: "main",
    metadata: '{"dirty":"owned"}',
  });
  const first = {
    nodes: [{ id: "symbol", label: "old", source_file: "source.rs", source_location: "L7" }],
    links: [{ source: "symbol", target: "external", confidence: "EXTRACTED" }],
  };
  await registry.importGraph(repository, first, "a");
  await registry.importGraph(repository, first, "a");
  await registry.importGraph(
    repository,
    { nodes: [{ id: "symbol", label: "new", source_file: "source.rs" }], links: [] },
    "b",
  );
  expect(registry.counts()).toMatchObject({ nodes: 3, edges: 1, graph_snapshots: 2 });
  expect(registry.db.query("SELECT label,line FROM nodes WHERE id=?").get(`${repository}:graph:a:symbol`)).toEqual({
    label: "old",
    line: 7,
  });
  expect(registry.db.query("SELECT provenance FROM nodes WHERE kind='unresolved'").get()).toEqual({
    provenance: "UNRESOLVED",
  });
  expect(registry.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("JSON exports contain all tables and survive failed atomic replacement", async () => {
  using directory = tempDir("bun-python-export", {});
  const path = join(String(directory), "bun_python.sqlite");
  using registry = new BunPython(path);
  const run = registry.startRun("test", ["bun", "test"], String(directory));
  registry.finishRun(run, 0, "passed");
  registry.event("validated", { run }, run);
  const output = await registry.export();
  const snapshot = await Bun.file(output).json();
  expect(snapshot.format).toBe("bun_python");
  expect(
    Object.fromEntries(Object.entries(snapshot.tables).map(([table, rows]) => [table, (rows as unknown[]).length])),
  ).toEqual(registry.counts());
  await expect(registry.export(path)).rejects.toThrow("cannot overwrite");
  const occupied = join(String(directory), "occupied");
  mkdirSync(occupied);
  await expect(registry.export(occupied)).rejects.toThrow();
  registry.event("after-failed-export", {});
  await registry.export(output);
  expect((await Bun.file(output).json()).tables.events).toHaveLength(2);
  expect(registry.db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
});

test("future SQLite schemas remain protected", () => {
  using directory = tempDir("bun-python-schema", {});
  const path = join(String(directory), "future.sqlite");
  const database = new Database(path);
  database.exec("PRAGMA user_version=2; CREATE TABLE protected(value TEXT); INSERT INTO protected VALUES('retained')");
  database.close();
  expect(() => new BunPython(path)).toThrow("Unsupported bun_python schema 2");
  const reopened = new Database(path, { readonly: true });
  expect(reopened.query("SELECT value FROM protected").get()).toEqual({ value: "retained" });
  reopened.close();
});

test("native graph queries isolate snapshots and bind wildcard labels literally", async () => {
  using registry = new BunPython(":memory:");
  const repository = registry.repository("b%_un", "source", "/work");
  const hash = "new'_%🦄";
  await registry.importGraph(repository, { nodes: [{ id: "a", label: "historical" }], links: [] }, "old");
  await registry.importGraph(
    repository,
    {
      nodes: [
        { id: "a", label: "a%_\\quote", source_file: "source.rs" },
        { id: "b", label: "alphabet" },
        { id: "c", label: "callee", source_file: "source.rs" },
      ],
      links: [
        { source: "a", target: "b", relation: "calls", confidence: "EXTRACTED" },
        { source: "b", target: "c", relation: "calls", confidence: "EXTRACTED" },
        { source: "c", target: "a", relation: "calls", confidence: "EXTRACTED" },
        { source: "a", target: "c", relation: "calls", confidence: "EXTRACTED" },
        { source: "a", target: "a", relation: "calls", confidence: "EXTRACTED" },
        { source: "c", target: "external", relation: "imports" },
      ],
    },
    hash,
  );
  const namespace = `${repository}:graph:${hash}:`;
  const a = namespace + "a",
    b = namespace + "b",
    c = namespace + "c",
    external = namespace + "external";
  expect(registry.queryNodes({ repositoryId: repository, search: "a%_\\" }).map(row => row.id)).toEqual([a]);
  expect(registry.queryNodes({ repositoryId: repository, label: "' OR 1=1 --" })).toEqual([]);
  expect(
    registry.queryNodes({ repositoryId: repository, snapshotId: `${repository}:graph:old` }).map(row => row.label),
  ).toEqual(["historical"]);
  expect(registry.getSnapshot(repository)?.sha256).toBe(hash);
  expect(registry.coverage({ repositoryId: repository })).toMatchObject({
    nodes: 4,
    edges: 6,
    unresolvedNodes: 1,
    nodeProvenance: { EXTRACTED: 2, INFERRED: 1, UNRESOLVED: 1 },
    edgeProvenance: { EXTRACTED: 5, UNKNOWN: 1 },
  });
  expect(registry.outgoing(a).map(row => row.id)).toEqual([b, c, a]);
  expect(registry.incoming(a).map(row => row.id)).toEqual([c, a]);
  expect(registry.neighbors(a, { direction: "both" })).toHaveLength(4);
  expect(registry.outgoing(a, { snapshotId: `${repository}:graph:old` })).toEqual([]);
  const full = await registry.traverse(a, { maxDepth: 6 });
  expect(full.nodes.map(row => [row.id, row.depth])).toEqual([
    [a, 0],
    [b, 1],
    [c, 1],
    [external, 2],
  ]);
  expect(full.truncated).toBe(false);
  const limited = await registry.traverse(a, { maxDepth: 6, nodeLimit: 2 });
  expect(limited.nodes.map(row => row.id)).toEqual([a, b]);
  expect(limited.truncated).toBe(true);
  const incoming = await registry.traverse(external, { direction: "incoming", maxDepth: 6 });
  expect(incoming.nodes.map(row => [row.id, row.depth])).toEqual([
    [external, 0],
    [c, 1],
    [a, 2],
    [b, 2],
  ]);
  expect((await registry.traverse(a, { direction: "both", maxDepth: 1 })).nodes.map(row => row.id)).toEqual([a, b, c]);
  expect(() => registry.queryNodes({ repositoryId: repository, limit: Infinity })).toThrow("limit must be");
  expect(() => registry.neighbors(a, { direction: "invalid" as never })).toThrow("direction must be");
  await expect(registry.traverse(a, { maxDepth: -1 })).rejects.toThrow("maxDepth must be");
});

test("failed asynchronous imports remain unpublished and resume idempotently", async () => {
  using registry = new BunPython(":memory:");
  const repository = registry.repository("bun", "source", "/work");
  const graph = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], links: [{ source: "a", target: "b" }] };
  await expect(
    registry.importGraph(
      repository,
      { nodes: [{ id: "a" }], links: [{ source: "a", target: "b", confidence_score: NaN }] },
      "invalid",
    ),
  ).rejects.toThrow("confidence must be");
  expect(registry.counts().nodes).toBe(0);
  const controller = new AbortController();
  const pending = registry.importGraph(repository, graph, "partial", { batchSize: 1, signal: controller.signal });
  const deadline = performance.now() + 1000;
  while (registry.counts().nodes === 0 && performance.now() < deadline) await scheduler.yield();
  expect(registry.counts().nodes).toBe(1);
  controller.abort(new Error("Cancelled import"));
  await expect(pending).rejects.toThrow("Cancelled import");
  expect(registry.getNode(`${repository}:graph:partial:a`)).toBeNull();
  expect(registry.queryNodes({ repositoryId: repository })).toEqual([]);
  expect(registry.getSnapshot(repository)).toBeNull();
  await registry.importGraph(repository, graph, "partial", { batchSize: 1 });
  expect(registry.queryNodes({ repositoryId: repository })).toHaveLength(3);
  await registry.importGraph(repository, { nodes: [{ id: "a", label: "replacement" }], links: [] }, "partial");
  expect(registry.getNode(`${repository}:graph:partial:a`)?.label).toBe("a");
  expect(registry.counts()).toMatchObject({ nodes: 3, edges: 1, graph_snapshots: 1 });
});

test("asynchronous JSON export retains its snapshot while another connection writes", async () => {
  using directory = tempDir("graph-export-concurrent", {});
  using registry = new BunPython(join(String(directory), "graph.sqlite"));
  using writer = new BunPython(registry.path);
  const payload = { text: "x".repeat(1024) };
  registry.db.transaction(() => {
    for (let index = 0; index < 1100; index++) registry.event("before", payload);
  })();
  const pending = registry.export();
  writer.event("during", {});
  const output = await pending;
  expect((await Bun.file(output).json()).tables.events).toHaveLength(1100);
  expect(registry.counts().events).toBe(1101);
});

test("file lookup, run filters and streamed artifact hashes preserve exact evidence", async () => {
  using directory = tempDir("graph-artifact", {});
  using registry = new BunPython(":memory:");
  const repository = registry.repository("bun", "source", String(directory));
  const path = "quoted'_% file.rs";
  registry.db.query("INSERT INTO files VALUES(?,?,?,?,?,?,?)").run("file", repository, path, "digest", "rust", 7, "{}");
  expect(registry.lookupFiles(repository, { path }).map(row => row.sha256)).toEqual(["digest"]);
  expect(registry.lookupFiles(repository, { sha256: "digest" }).map(row => row.path)).toEqual([path]);
  expect(registry.lookupFiles(repository, { path: "' OR 1=1 --" })).toEqual([]);
  const run = registry.startRun("benchmark", ["bun", "--version"], String(directory));
  registry.finishRun(run, 0);
  expect(registry.queryRuns({ status: "passed", kind: "benchmark" }).map(row => (row as { id: string }).id)).toEqual([
    run,
  ]);
  expect(registry.queryRuns({ status: "failed" })).toEqual([]);
  const content = new Uint8Array(131075).fill(255);
  content[65536] = 7;
  const artifact = join(String(directory), "binary.bin");
  await Bun.write(artifact, content);
  const expected = new Bun.CryptoHasher("sha256").update(content).digest("hex");
  expect(await registry.artifact(artifact, "source", run)).toBe(expected);
  expect(registry.db.query("SELECT bytes,sha256 FROM artifacts").get()).toEqual({
    bytes: content.byteLength,
    sha256: expected,
  });
});
