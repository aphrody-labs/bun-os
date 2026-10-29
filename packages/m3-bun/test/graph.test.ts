// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildApp } from "../src/build.ts";
import { dependents, graphReport, moduleGraph, openGraph } from "../src/graph.ts";
import { cleanup, fixtureCopy, tmp } from "./helpers.ts";

afterAll(cleanup);

describe("moduleGraph", () => {
  test("inputs, outputs, imports and bundled-into links of a Bun.build metafile", async () => {
    const dir = tmp();
    await Bun.write(
      join(dir, "index.html"),
      '<link rel="stylesheet" href="./s.css"><script type="module" src="./a.ts"></script>',
    );
    await Bun.write(join(dir, "a.ts"), 'import { b } from "./b.ts"; import("./c.ts"); console.log(b);');
    await Bun.write(join(dir, "b.ts"), "export const b = 1;");
    await Bun.write(join(dir, "c.ts"), "export const c = 1;");
    await Bun.write(join(dir, "s.css"), "body { color: red }");
    const { metafile } = await Bun.build({
      entrypoints: [join(dir, "index.html")],
      root: dir,
      outdir: join(dir, "out"),
      splitting: true,
      metafile: true,
    });
    const graph = moduleGraph(metafile!, "index.html", dir);
    const ids = new Set(graph.nodes.map(n => n.id));
    expect(ids.size).toBe(graph.nodes.length);
    expect([...ids].filter(id => id.startsWith("input:")).toSorted()).toEqual([
      "input:a.ts",
      "input:b.ts",
      "input:c.ts",
      "input:index.html",
      "input:s.css",
    ]);
    expect(ids.has("output:index.html")).toBe(true);
    for (const link of graph.links) {
      expect(ids.has(link.source)).toBe(true);
      expect(ids.has(link.target)).toBe(true);
    }
    const relations = graph.links.map(
      l => `${l.source} ${l.relation} ${l.target.startsWith("output:") ? "output" : l.target}`,
    );
    expect(relations).toContain("input:a.ts import-statement input:b.ts");
    expect(relations).toContain("input:index.html import-rule input:s.css");
    expect(relations).toContain("input:a.ts dynamic-import output");
    expect(relations).toContain("input:b.ts bundled-into output");
    expect(relations).toContain("input:s.css bundled-into output");
  });
});

describe("m3-bun build --graph", () => {
  test("a build is a run with its artifacts and duration, and the module graph a snapshot", async () => {
    const dir = fixtureCopy();
    const report = await buildApp({ dir, graph: true });
    const record = report.graph!;
    expect(record.path).toBe(join(dir, ".m3-bun", "graph.sqlite"));
    expect(record.repositoryId).toBe("m3-app:hello-m3");
    using registry = await openGraph(record.path);
    expect(registry.queryRuns({ kind: "m3-bun.build" }).map(run => run.status)).toEqual(["passed"]);
    const artifacts = registry.db
      .query<{ sha256: string; bytes: number; metadata: string }, [string]>(
        "SELECT sha256, bytes, metadata FROM artifacts WHERE run_id = ? ORDER BY path",
      )
      .all(record.runId);
    expect(
      artifacts.map(a => ({
        path: JSON.parse(a.metadata).path,
        sha256: a.sha256,
        bytes: a.bytes,
      })),
    ).toEqual(
      report.manifest.files
        .map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }))
        .toSorted((a, b) => a.path.localeCompare(b.path)),
    );
    expect(
      registry.db
        .query<{ milliseconds: number }, [string]>("SELECT milliseconds FROM samples WHERE run_id = ?")
        .get(record.runId)!.milliseconds,
    ).toBe(report.ms);
    const coverage = registry.coverage({ repositoryId: record.repositoryId });
    expect(coverage.snapshot!.id).toBe(record.snapshotId);
    expect({
      nodes: coverage.nodes,
      edges: coverage.edges,
      unresolved: coverage.unresolvedNodes,
    }).toEqual({
      nodes: record.nodes,
      edges: record.edges,
      unresolved: 0,
    });
    const labels = registry.queryNodes({ repositoryId: record.repositoryId, limit: 500 }).map(n => n.label);
    expect(labels).toContain("src/main.ts");
    expect(labels).toContain("index.html");
  });

  test("m3-bun graph <file> lists what depends on it; the report names the app", async () => {
    const dir = fixtureCopy();
    const { app } = await buildApp({ dir, graph: true });
    const found = await dependents(app, "src/main.ts");
    expect(found).toContainEqual({
      label: "src/index.html",
      kind: "file",
      depth: 1,
    });
    expect(found.some(n => n.kind === "output" && n.label.endsWith(".js"))).toBe(true);
    expect(await graphReport(app)).toContain("m3-app:hello-m3");
    expect(dependents(app, "src/none.ts")).rejects.toThrow("is not an input");
  });
});

describe("graph registry", () => {
  test("a recorded module graph answers dependents, coverage and the report without the m3 build", async () => {
    const dir = tmp();
    await Bun.write(join(dir, "index.html"), '<script type="module" src="./a.ts"></script>');
    await Bun.write(join(dir, "a.ts"), 'import { b } from "./b.ts"; console.log(b);');
    await Bun.write(join(dir, "b.ts"), "export const b = 1;");
    const { metafile } = await Bun.build({
      entrypoints: [join(dir, "index.html")],
      root: dir,
      outdir: join(dir, "out"),
      metafile: true,
    });
    const graph = moduleGraph(metafile!, "index.html", dir);
    const path = join(dir, ".m3-bun", "graph.sqlite");
    {
      using registry = await openGraph(path);
      const repository = registry.repository("demo", "m3-app", dir, null);
      const run = registry.startRun("m3-bun.build", [], dir);
      registry.sample(run, "build", "bun", 0, 12.5);
      await registry.artifact(join(dir, "index.html"), "m3-bun.output", run, { path: "index.html" });
      const imported = await registry.importGraph(repository, graph, "h1");
      registry.finishRun(run, 0, "1 files");
      expect(imported).toEqual({ nodes: graph.nodes.length, edges: graph.links.length });
      expect(registry.queryRuns({ kind: "m3-bun.build" }).map(r => r.status)).toEqual(["passed"]);
      const coverage = registry.coverage({ repositoryId: repository });
      expect({ nodes: coverage.nodes, edges: coverage.edges, unresolved: coverage.unresolvedNodes }).toEqual({
        nodes: graph.nodes.length,
        edges: graph.links.length,
        unresolved: 0,
      });
      expect(registry.queryNodes({ repositoryId: repository }).map(n => n.label)).toContain("b.ts");
    }
    const app = { name: "demo", dir } as never;
    const found = await dependents(app, "b.ts");
    expect(found.map(n => n.label)).toContain("a.ts");
    expect(found.some(n => n.kind === "output")).toBe(true);
    expect(await graphReport(app)).toContain("m3-app:demo");
    expect(dependents(app, "none.ts")).rejects.toThrow("is not an input");
  });
});
