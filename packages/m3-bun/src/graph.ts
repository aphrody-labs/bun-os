// SPDX-License-Identifier: Apache-2.0
// The build graph of an M3 app in a SQLite registry (graph-registry.ts): the app is a repository, each `m3-bun build`
// a run (status, duration sample, output artifacts with their SHA-256) and the module graph of `Bun.build`'s metafile
// a snapshot (inputs, outputs, imports, which input went into which output).
// `m3-bun graph` reads it back: the markdown report, or what depends on a file.
import type { BuildMetafile } from "bun";
import { join, relative, resolve } from "node:path";
import type { BuildReport } from "./build.ts";
import type { M3App } from "./config.ts";
import { GraphRegistry } from "./graph-registry.ts";
import { sha256 } from "./util.ts";

/** Registry of an app when no path is given: next to its config, out of the build directory. */
export const graphPath = (app: M3App): string => join(app.dir, ".m3-bun", "graph.sqlite");

/** Repository id of an app in the registry. */
export const repositoryId = (app: M3App): string => `m3-app:${app.name}`;

/** Opens (creating it when needed) the registry file at `path`. */
export async function openGraph(path: string): Promise<GraphRegistry> {
  return new GraphRegistry(path);
}

// A type alias, not an interface: `importGraph` takes records with an index signature.
export type ModuleGraph = {
  producer: "m3-bun";
  nodes: {
    id: string;
    label: string;
    file_type: string;
    source_file?: string;
    provenance: "EXTRACTED";
    bytes: number;
  }[];
  links: {
    source: string;
    target: string;
    relation: string;
    confidence: "EXTRACTED";
    confidence_score: 1;
    bytes?: number;
  }[];
};

const output = (path: string, entry: string): string => {
  const clean = path.replace(/^\.\//, "");
  // `buildApp` hoists the HTML entry to the build root.
  return `output:${clean === entry ? "index.html" : clean}`;
};

const isVirtual = (path: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path);

/**
 * The metafile as graph nodes and links. Inputs are `input:<path relative to dir>` (the metafile keys them by the
 * working directory; virtual modules keep their `m3:` specifier), outputs `output:<path in the build directory>`; links are the imports (relation: the import kind)
 * and `bundled-into` from an input to every output it contributed bytes to.
 */
export function moduleGraph(metafile: BuildMetafile, entry: string, dir: string = process.cwd()): ModuleGraph {
  const local = (path: string): string => (isVirtual(path) ? path : relative(dir, resolve(path)).replaceAll("\\", "/"));
  const nodes: ModuleGraph["nodes"] = [];
  const links: ModuleGraph["links"] = [];
  const external = new Set<string>();
  for (const [key, input] of Object.entries(metafile.inputs)) {
    const virtual = isVirtual(key);
    const path = local(key);
    nodes.push({
      id: `input:${path}`,
      label: path,
      file_type: virtual ? "virtual" : (input.format ?? "file"),
      ...(virtual ? {} : { source_file: path }),
      provenance: "EXTRACTED",
      bytes: input.bytes,
    });
    for (const imported of input.imports) {
      let target = `input:${local(imported.path)}`;
      if (imported.entryPoint) target = output(imported.path, entry);
      else if (imported.external) {
        target = `external:${imported.path}`;
        external.add(imported.path);
      }
      links.push({
        source: `input:${path}`,
        target,
        relation: imported.kind,
        confidence: "EXTRACTED",
        confidence_score: 1,
      });
    }
  }
  for (const path of external)
    nodes.push({
      id: `external:${path}`,
      label: path,
      file_type: "external",
      provenance: "EXTRACTED",
      bytes: 0,
    });
  for (const [path, built] of Object.entries(metafile.outputs)) {
    const id = output(path, entry);
    nodes.push({
      id,
      label: id.slice("output:".length),
      file_type: "output",
      provenance: "EXTRACTED",
      bytes: built.bytes,
    });
    for (const [source, contribution] of Object.entries(built.inputs))
      links.push({
        source: `input:${local(source)}`,
        target: id,
        relation: "bundled-into",
        confidence: "EXTRACTED",
        confidence_score: 1,
        bytes: contribution.bytesInOutput,
      });
    for (const imported of built.imports)
      links.push({
        source: id,
        target: output(imported.path, entry),
        relation: imported.kind,
        confidence: "EXTRACTED",
        confidence_score: 1,
      });
    if (built.cssBundle)
      links.push({
        source: id,
        target: output(built.cssBundle, entry),
        relation: "css-bundle",
        confidence: "EXTRACTED",
        confidence_score: 1,
      });
  }
  return { producer: "m3-bun", nodes, links };
}

export interface GraphRecord {
  path: string;
  repositoryId: string;
  runId: string;
  snapshotId: string;
  nodes: number;
  edges: number;
}

/** Record a finished build: run, duration sample, output artifacts and the module graph snapshot. */
export async function recordBuild(
  report: BuildReport,
  metafile: BuildMetafile,
  path = graphPath(report.app),
): Promise<GraphRecord> {
  using registry = await openGraph(path);
  const { app, manifest } = report;
  const repository = registry.repository(app.name, "m3-app", app.dir, null, {
    version: app.version,
  });
  const runId = registry.startRun("m3-bun.build", process.argv.slice(1), app.dir, {
    buildId: manifest.buildId,
    minify: manifest.minify,
    bun: manifest.bun,
  });
  try {
    registry.sample(runId, "build", `bun ${manifest.bun}`, 0, report.ms, manifest.buildId);
    for (const file of manifest.files) {
      // oxlint-disable-next-line no-await-in-loop -- The registry hashes one artifact at a time from a stream.
      await registry.artifact(join(report.outdir, file.path), "m3-bun.output", runId, {
        path: file.path,
        gzipBytes: file.gzipBytes,
      });
    }
    const graph = moduleGraph(metafile, relative(app.dir, app.m3.entry).replaceAll("\\", "/"), app.dir);
    const hash = sha256(JSON.stringify(graph));
    const imported = await registry.importGraph(repository, graph, hash);
    registry.finishRun(runId, 0, `${manifest.files.length} files, build ${manifest.buildId}`);
    return {
      path: registry.path,
      repositoryId: repository,
      runId,
      snapshotId: `${repository}:graph:${hash}`,
      nodes: imported.nodes,
      edges: imported.edges,
    };
  } catch (error) {
    registry.finishRun(runId, 1, "", String(error));
    throw error;
  }
}

/** The markdown report of an app's builds. */
export async function graphReport(app: M3App, path = graphPath(app)): Promise<string> {
  using registry = await openGraph(path);
  return registry.markdown(repositoryId(app));
}

/** Inputs and outputs that depend on `file` (relative to the app) in the latest build: its importers, transitively. */
export async function dependents(
  app: M3App,
  file: string,
  path = graphPath(app),
): Promise<{ label: string; kind: string; depth: number }[]> {
  using registry = await openGraph(path);
  const snapshot = registry.getSnapshot(repositoryId(app));
  if (!snapshot) throw new Error(`m3-bun graph: no build of ${app.name} recorded in ${path} (m3-bun build --graph)`);
  const node = registry.getNode(`${snapshot.id}:input:${file.replaceAll("\\", "/")}`);
  if (!node) throw new Error(`m3-bun graph: ${file} is not an input of build snapshot ${snapshot.id}`);
  const { nodes } = registry.traverse(node.id, {
    direction: "incoming",
    maxDepth: 32,
  });
  const bundled = registry.traverse(node.id, {
    direction: "outgoing",
    kind: "bundled-into",
    maxDepth: 1,
  });
  return [...nodes, ...bundled.nodes.filter(n => n.depth > 0)]
    .filter(n => n.depth > 0)
    .map(n => ({ label: n.label, kind: n.kind, depth: n.depth }));
}
