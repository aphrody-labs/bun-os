// SPDX-License-Identifier: Apache-2.0
// Ported from the aphrody-labs/bun fork (test/internal/pyjs.test.ts, native graph part): bun:graph-native over
// `aphrody-graph exec` (crates/aphrody-code-graph). Needs a build carrying `exec`; BUN_OS_TEST_NATIVE_GRAPH=1
// turns a missing engine into a failure instead of a skip.
import { expect, test } from "bun:test";
import * as nativeGraph from "../src/graph/native.ts";

function engineAvailable(): boolean {
  try {
    const binary = nativeGraph.graphBinary();
    const help = Bun.spawnSync([binary, "exec", "--help"], { stdout: "pipe", stderr: "pipe" });
    return help.exitCode === 0;
  } catch {
    return false;
  }
}
const available = engineAvailable();
if (!available && process.env.BUN_OS_TEST_NATIVE_GRAPH === "1")
  throw new Error("aphrody-graph with the exec subcommand is required (BUN_OS_TEST_NATIVE_GRAPH=1)");
const nativeGraphBuiltin = available ? nativeGraph : undefined;

test.skipIf(!nativeGraphBuiltin)(
  "native Rust extraction preserves Unicode evidence, confidence and directed paths",
  async () => {
    const scope = { source: "graph:fixture" as const, profile: "aphrody" };
    const built = await nativeGraphBuiltin!.executeGraph({
      op: "build",
      scope,
      files: [{ path: "src/été.rs", content: "pub fn café() -> i32 { 42 }\npub fn run() -> i32 { café() }\n" }],
      packages: { package_of: { "src/été.rs": "fixture" }, package_dir: { fixture: "src" } },
    });
    expect(built.scope).toEqual(scope);
    expect(built.result.parse_errors).toEqual([]);
    const graph = built.result.graph;
    const cafe = graph.nodes.find(node => node.label === "café()");
    const run = graph.nodes.find(node => node.label === "run()");
    expect(cafe).toMatchObject({ source_file: "src/été.rs", lang: "rust", package: "fixture" });
    expect(run).toMatchObject({ source_file: "src/été.rs", lang: "rust" });
    expect(graph.links.find(link => link.source === run!.id && link.target === cafe!.id)).toMatchObject({
      relation: "calls",
      confidence: "EXTRACTED",
      confidence_score: 1,
      source_file: "src/été.rs",
    });
    const path = await nativeGraphBuiltin!.executeGraph({
      op: "path",
      scope,
      graph,
      from: run!.id,
      to: cafe!.id,
      directed: true,
      relations: ["calls"],
    });
    expect(path.result.hops?.map(hop => hop.node)).toEqual([run!.id, cafe!.id]);
    expect(path.result.hops?.[1]?.forward).toBe(true);
    const reverse = await nativeGraphBuiltin!.executeGraph({
      op: "path",
      scope,
      graph,
      from: cafe!.id,
      to: run!.id,
      directed: true,
      relations: ["calls"],
    });
    expect(reverse.result.hops).toBeNull();
  },
);

test.skipIf(!nativeGraphBuiltin)(
  "native graph rejects unsafe source paths and invalid domain scopes through worker errors",
  async () => {
    const scope = { source: "graph:fixture" as const, profile: "aphrody" };
    await expect(
      nativeGraphBuiltin!.executeGraph({
        op: "build",
        scope,
        files: [{ path: "../outside.rs", content: "fn run() {}" }],
      }),
    ).rejects.toThrow("distinct relative paths");
    await expect(
      nativeGraphBuiltin!.executeGraph({
        op: "export",
        scope: { ...scope, profile: "../dbfr" },
        graph: { nodes: [], links: [] },
      }),
    ).rejects.toThrow("profile");
    await expect(
      nativeGraphBuiltin!.executeGraph(
        { op: "export", scope, graph: { nodes: [], links: [] } },
        { signal: {} as AbortSignal },
      ),
    ).rejects.toThrow("AbortSignal");
  },
);

test.skipIf(!nativeGraphBuiltin)("native graph cancellation rejects with the abort reason", async () => {
  const request = {
    op: "export" as const,
    scope: { source: "graph:fixture" as const, profile: "aphrody" },
    graph: { nodes: [], links: [] },
  };
  const controller = new AbortController();
  const reason = new Error("graph request cancelled by owner");
  const pending = nativeGraphBuiltin!.executeGraph(request, { signal: controller.signal });
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  await expect(nativeGraphBuiltin!.executeGraph(request, { signal: controller.signal })).rejects.toBe(reason);
});

test.skipIf(!nativeGraphBuiltin)(
  "native graph rejects excess jobs instead of queueing and recovers all cancelled capacity",
  async () => {
    const request = {
      op: "export" as const,
      scope: { source: "graph:fixture" as const, profile: "aphrody" },
      graph: { nodes: [], links: [] },
    };
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const pending = controllers.map(controller =>
      nativeGraphBuiltin!.executeGraph(request, { signal: controller.signal }),
    );
    try {
      await expect(nativeGraphBuiltin!.executeGraph(request)).rejects.toThrow("capacity");
    } finally {
      for (const controller of controllers) controller.abort(new Error("capacity test finished"));
      await Promise.allSettled(pending);
    }
    expect((await nativeGraphBuiltin!.executeGraph(request)).result.graph).toMatchObject({ nodes: [], links: [] });
  },
);

test.skipIf(!nativeGraphBuiltin)("indexCodebase records native facts of a git checkout in the registry", async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { BunPython, indexCodebase } = await import("../src/graph/registry.ts");
  const root = mkdtempSync(join(tmpdir(), "graph-index-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "export function a() { b(); }\nexport function b() {}\n");
    writeFileSync(join(root, "src", "lib.rs"), "pub fn x() {}\n");
    const git = (...args: string[]) =>
      expect(Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root }).exitCode).toBe(
        0,
      );
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "fixture");
    using registry = new BunPython(":memory:");
    const result = await indexCodebase(registry, root, { profile: "bun", surfaces: ["src"] });
    expect(result.dirty).toBe(false);
    expect(result.producerSHA256).toMatch(/^[a-f\d]{64}$/);
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]!.coverage).toMatchObject({ files: 2, nativeFiles: 2, parseErrors: 0 });
    expect(registry.counts()).toMatchObject({ files: 2, graph_snapshots: 1 });
    expect(registry.counts().nodes).toBeGreaterThan(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
