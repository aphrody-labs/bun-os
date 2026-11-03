// SPDX-License-Identifier: Apache-2.0
// `bun:graph` of the aphrody-labs/bun fork (src/js/bun/graph.ts) on upstream Bun: the BunPython (PyJS) SQLite
// registry of repositories, files, graph nodes and edges, snapshots, runs, samples, fixes, events and artifacts.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { scheduler } from "node:timers/promises";
import { indexCodebase as indexCodebaseImpl } from "./index-codebase.ts";
import { executeGraph as executeGraphImpl } from "./native.ts";
import type { GraphRequest, IndexOptions } from "./types.ts";

const registryPath = resolve(process.cwd(), "bun_python.sqlite");
const tables = [
  "repositories",
  "files",
  "nodes",
  "edges",
  "graph_snapshots",
  "runs",
  "samples",
  "fixes",
  "events",
  "artifacts",
] as const;
const json = (value: unknown) => JSON.stringify(value ?? null);
type Scope = { repositoryId: string; snapshotId?: string };
type NodeRow = {
  id: string;
  repository_id: string;
  kind: string;
  label: string;
  file: string | null;
  line: number | null;
  provenance: string;
  metadata: string;
};
type FileRow = {
  id: string;
  repository_id: string;
  path: string;
  sha256: string;
  language: string;
  bytes: number;
  metadata: string;
};
type SnapshotRow = {
  id: string;
  repository_id: string;
  producer: string;
  revision: string | null;
  sha256: string;
  created_at: string;
  metadata: string;
};
type Direction = "incoming" | "outgoing" | "both";
type Bind = string | number | null;
function bounded(name: string, value: number | undefined, fallback: number, maximum: number, minimum = 0) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  return result;
}
function direction(value: Direction = "outgoing") {
  if (value !== "incoming" && value !== "outgoing" && value !== "both")
    throw new TypeError("direction must be incoming, outgoing or both");
  return value;
}

class BunPython implements Disposable {
  readonly db: Database;
  readonly path: string;

  constructor(path = registryPath) {
    this.path = path === ":memory:" ? path : resolve(path);
    const databasePath = this.path;
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(this.path, { create: true, strict: true });
    const database = this.db;
    database.exec("PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON;");
    if (
      databasePath !== ":memory:" &&
      database.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()!.journal_mode !== "wal"
    )
      database.exec("PRAGMA journal_mode=WAL");
    const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
    if (version > 1) {
      this.db.close();
      throw new Error(`Unsupported bun_python schema ${version}`);
    }
    if (version === 0)
      this.db.transaction(() => {
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS repositories (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, root TEXT NOT NULL,
          revision TEXT, branch TEXT, metadata TEXT NOT NULL CHECK(json_valid(metadata))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
          path TEXT NOT NULL, sha256 TEXT NOT NULL, language TEXT NOT NULL, bytes INTEGER NOT NULL,
          metadata TEXT NOT NULL CHECK(json_valid(metadata)), UNIQUE(repository_id,path)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
          kind TEXT NOT NULL, label TEXT NOT NULL, file TEXT, line INTEGER,
          provenance TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS edges (
          id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
          source TEXT NOT NULL REFERENCES nodes(id), target TEXT NOT NULL REFERENCES nodes(id),
          kind TEXT NOT NULL, provenance TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
          metadata TEXT NOT NULL CHECK(json_valid(metadata))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS graph_snapshots (
          id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
          producer TEXT NOT NULL, revision TEXT, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
          metadata TEXT NOT NULL CHECK(json_valid(metadata))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, command TEXT NOT NULL CHECK(json_valid(command)),
          cwd TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
          status TEXT NOT NULL CHECK(status IN ('running','passed','failed','interrupted')),
          exit_code INTEGER, stdout TEXT, stderr TEXT, metadata TEXT NOT NULL CHECK(json_valid(metadata))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS samples (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL,
          implementation TEXT NOT NULL, sample INTEGER NOT NULL CHECK(sample>=0),
          milliseconds REAL NOT NULL CHECK(milliseconds>=0), result TEXT,
          UNIQUE(run_id,name,implementation,sample)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS fixes (
          id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
          summary TEXT NOT NULL, before_revision TEXT, after_revision TEXT,
          paths TEXT NOT NULL CHECK(json_valid(paths)), validation_runs TEXT NOT NULL CHECK(json_valid(validation_runs)),
          metadata TEXT NOT NULL CHECK(json_valid(metadata))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), created_at TEXT NOT NULL,
          kind TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), path TEXT NOT NULL, kind TEXT NOT NULL,
          sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS files_hash ON files(sha256);
        CREATE INDEX IF NOT EXISTS nodes_label ON nodes(label);
        CREATE INDEX IF NOT EXISTS nodes_file ON nodes(repository_id,file);
        CREATE INDEX IF NOT EXISTS edges_source ON edges(source);
        CREATE INDEX IF NOT EXISTS edges_target ON edges(target);
        CREATE INDEX IF NOT EXISTS samples_case ON samples(name,implementation);
        PRAGMA user_version=1;
      `);
      })();
    const indexes = this.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'").all();
    for (const [name, definition] of [
      ["snapshots_repository", "graph_snapshots(repository_id,created_at DESC)"],
      ["nodes_repository", "nodes(repository_id,id)"],
      ["edges_repository", "edges(repository_id,id)"],
      ["fixes_repository", "fixes(repository_id,id)"],
      ["runs_status", "runs(status,started_at DESC)"],
    ])
      if (!indexes.some(index => index.name === name))
        this.db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${definition}`);
  }

  repository(
    name: string,
    kind: string,
    root: string,
    revision: string | null = null,
    metadata: unknown = {},
    branch: string | null = null,
  ) {
    const id = `${kind}:${name}`;
    this.db
      .query(
        `INSERT INTO repositories VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      root=excluded.root,revision=COALESCE(excluded.revision,repositories.revision),
      branch=COALESCE(excluded.branch,repositories.branch),metadata=json_patch(repositories.metadata,excluded.metadata)`,
      )
      .run(id, name, kind, root, revision, branch, json(metadata));
    return id;
  }

  startRun(kind: string, command: string[], cwd: string, metadata: unknown = {}) {
    const id = randomUUID();
    this.db
      .query("INSERT INTO runs VALUES(?,?,?,?,?,NULL,'running',NULL,NULL,NULL,?)")
      .run(id, kind, json(command), cwd, new Date().toISOString(), json(metadata));
    return id;
  }

  finishRun(id: string, exitCode: number, stdout = "", stderr = "") {
    const change = this.db
      .query("UPDATE runs SET finished_at=?,status=?,exit_code=?,stdout=?,stderr=? WHERE id=? AND status='running'")
      .run(new Date().toISOString(), exitCode === 0 ? "passed" : "failed", exitCode, stdout, stderr, id);
    if (change.changes !== 1) throw new Error(`Run ${id} is missing or already finished`);
  }

  sample(runId: string, name: string, implementation: string, sample: number, milliseconds: number, result?: string) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isSafeInteger(sample) || sample < 0) {
      throw new Error("Invalid benchmark sample");
    }
    this.db
      .query("INSERT INTO samples VALUES(?,?,?,?,?,?,?)")
      .run(randomUUID(), runId, name, implementation, sample, milliseconds, result ?? null);
  }

  event(kind: string, payload: unknown, runId: string | null = null) {
    this.db
      .query("INSERT INTO events VALUES(?,?,?,?,?)")
      .run(randomUUID(), runId, new Date().toISOString(), kind, json(payload));
  }

  async artifact(path: string, kind: string, runId: string | null = null, metadata: unknown = {}) {
    const absolute = resolve(path);
    const hasher = new Bun.CryptoHasher("sha256");
    let bytes = 0;
    for await (const chunk of Bun.file(absolute).stream()) {
      hasher.update(chunk);
      bytes += chunk.byteLength;
    }
    const sha256 = hasher.digest("hex");
    this.db
      .query("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)")
      .run(randomUUID(), runId, absolute, kind, sha256, bytes, json(metadata));
    return sha256;
  }

  async importGraph(
    repositoryId: string,
    graph: {
      nodes: Record<string, unknown>[];
      links?: Record<string, unknown>[];
      edges?: Record<string, unknown>[];
      [key: string]: unknown;
    },
    sha256: string,
    options: { signal?: AbortSignal; batchSize?: number } = {},
  ) {
    if (
      !Array.isArray(graph.nodes) ||
      (graph.links !== undefined && !Array.isArray(graph.links)) ||
      (graph.edges !== undefined && !Array.isArray(graph.edges))
    )
      throw new TypeError("Graph nodes and edges must be arrays");
    if (typeof sha256 !== "string" || !sha256.length) throw new TypeError("Graph snapshot hash must be nonempty");
    options.signal?.throwIfAborted();
    const snapshotId = `${repositoryId}:graph:${sha256}`;
    const published = this.db
      .query<{ metadata: string }, [string]>("SELECT metadata FROM graph_snapshots WHERE id=?")
      .get(snapshotId);
    if (published) {
      const { nodes, edges, unresolved } = JSON.parse(published.metadata);
      return { nodes: Number(nodes), edges: Number(edges), unresolved: Number(unresolved) };
    }
    const links = graph.links ?? graph.edges ?? [];
    const identifiers = new Set<string>();
    const batchSize = bounded("batchSize", options.batchSize, 1000, 5000, 1);
    let scanned = 0;
    for (const node of graph.nodes) {
      options.signal?.throwIfAborted();
      if (!node || (typeof node.id !== "string" && typeof node.id !== "number"))
        throw new TypeError("Graph node id must be a string or number");
      const id = String(node.id);
      if (identifiers.has(id)) throw new TypeError(`Duplicate graph node id ${id}`);
      identifiers.add(id);
      if (++scanned % batchSize === 0) await scheduler.yield();
    }
    for (const edge of links) {
      options.signal?.throwIfAborted();
      if (
        !edge ||
        (typeof edge.source !== "string" && typeof edge.source !== "number") ||
        (typeof edge.target !== "string" && typeof edge.target !== "number")
      )
        throw new TypeError("Graph edge endpoints must be strings or numbers");
      const confidence = edge.confidence_score;
      if (
        confidence !== undefined &&
        (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      )
        throw new RangeError("Graph edge confidence must be between 0 and 1");
      if (++scanned % batchSize === 0) await scheduler.yield();
    }
    const nodes = this.db.query(
      "INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,label=excluded.label,file=excluded.file,line=excluded.line,provenance=excluded.provenance,metadata=excluded.metadata",
    );
    const edges = this.db.query(
      "INSERT INTO edges VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,confidence=excluded.confidence,provenance=excluded.provenance",
    );
    const namespace = `${repositoryId}:graph:${sha256}:`;
    let unresolved = 0;
    const insertNodes = this.db.transaction((start: number, end: number) => {
      for (let index = start; index < end; index++) {
        const node = graph.nodes[index]!;
        const line = typeof node.source_location === "string" ? /^L(\d+)/.exec(node.source_location)?.[1] : undefined;
        nodes.run(
          `${namespace}${node.id}`,
          repositoryId,
          String(node.file_type ?? node.kind ?? "symbol"),
          String(node.label ?? node.name ?? node.id),
          typeof node.source_file === "string" ? node.source_file : null,
          line ? Number(line) : null,
          typeof node.provenance === "string" && ["EXTRACTED", "INFERRED", "UNRESOLVED"].includes(node.provenance)
            ? node.provenance
            : typeof node.source_file === "string"
              ? "EXTRACTED"
              : "INFERRED",
          json(node),
        );
      }
    });
    const insertEdges = this.db.transaction((start: number, end: number) => {
      for (let index = start; index < end; index++) {
        const edge = links[index]!;
        const source = String(edge.source);
        const target = String(edge.target);
        for (const identifier of [source, target]) {
          if (!identifiers.has(identifier)) {
            nodes.run(
              `${namespace}${identifier}`,
              repositoryId,
              "unresolved",
              identifier,
              null,
              null,
              "UNRESOLVED",
              "{}",
            );
            identifiers.add(identifier);
            unresolved++;
          }
        }
        const score =
          typeof edge.confidence_score === "number" ? edge.confidence_score : edge.confidence === "EXTRACTED" ? 1 : 0;
        edges.run(
          `${namespace}edge:${index}`,
          repositoryId,
          `${namespace}${source}`,
          `${namespace}${target}`,
          String(edge.relation ?? edge.kind ?? "related"),
          String(edge.confidence ?? edge.provenance ?? "UNKNOWN"),
          score,
          json(edge),
        );
      }
    });
    for (let start = 0; start < graph.nodes.length; start += batchSize) {
      options.signal?.throwIfAborted();
      insertNodes(start, Math.min(start + batchSize, graph.nodes.length));
      // Yield outside the write transaction so other connections can record their runs.
      await scheduler.yield();
    }
    for (let start = 0; start < links.length; start += batchSize) {
      options.signal?.throwIfAborted();
      insertEdges(start, Math.min(start + batchSize, links.length));
      await scheduler.yield();
    }
    options.signal?.throwIfAborted();
    this.db.query("INSERT INTO graph_snapshots VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").run(
      snapshotId,
      repositoryId,
      String(graph.producer ?? "aphrody graph"),
      typeof graph.built_at_commit === "string" ? graph.built_at_commit : null,
      sha256,
      new Date().toISOString(),
      json({
        namespace,
        nodes: graph.nodes.length,
        edges: links.length,
        unresolved,
        hyperedges: graph.hyperedges ?? [],
        graph: graph.graph ?? {},
        directed: graph.directed,
        multigraph: graph.multigraph,
      }),
    );
    return { nodes: graph.nodes.length, edges: links.length, unresolved };
  }

  fix(
    repositoryId: string,
    summary: string,
    paths: string[],
    beforeRevision: string | null,
    afterRevision: string | null,
    validationRuns: string[] = [],
    metadata: unknown = {},
  ) {
    this.db
      .query("INSERT INTO fixes VALUES(?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        repositoryId,
        summary,
        beforeRevision,
        afterRevision,
        json(paths),
        json(validationRuns),
        json(metadata),
      );
  }

  snapshots(repositoryId: string, options: { limit?: number; offset?: number } = {}) {
    return this.db
      .query<SnapshotRow, Bind[]>(
        "SELECT * FROM graph_snapshots WHERE repository_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?",
      )
      .all(repositoryId, bounded("limit", options.limit, 100, 10000, 1), bounded("offset", options.offset, 0, 1000000));
  }

  getSnapshot(repositoryId: string, snapshotId?: string) {
    return snapshotId === undefined
      ? this.db
          .query<SnapshotRow, [string]>(
            "SELECT * FROM graph_snapshots WHERE repository_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
          )
          .get(repositoryId)
      : this.db
          .query<SnapshotRow, [string, string]>("SELECT * FROM graph_snapshots WHERE repository_id=? AND id=?")
          .get(repositoryId, snapshotId);
  }

  #scope(scope: Scope) {
    const snapshotId = scope.snapshotId;
    const snapshot = this.getSnapshot(scope.repositoryId, snapshotId);
    if (snapshotId !== undefined && !snapshot) throw new Error(`Unknown graph snapshot ${snapshotId}`);
    if (!snapshot) return { snapshot: null, namespace: null, end: null };
    const namespace: unknown = JSON.parse(snapshot.metadata).namespace;
    if (typeof namespace !== "string" || !namespace.endsWith(":"))
      throw new Error(`Graph snapshot ${snapshot.id} has no indexed namespace`);
    return { snapshot, namespace, end: namespace.slice(0, -1) + ";" };
  }

  getNode(id: string) {
    const node = this.db.query<NodeRow, [string]>("SELECT * FROM nodes WHERE id=?").get(id);
    if (!node || !id.startsWith(`${node.repository_id}:graph:`)) return node;
    const published = this.db
      .query<{ found: number }, [string, string]>(
        `SELECT 1 AS found FROM graph_snapshots WHERE repository_id=? AND substr(?,1,length(json_extract(metadata,'$.namespace')))=json_extract(metadata,'$.namespace') LIMIT 1`,
      )
      .get(node.repository_id, id);
    return published ? node : null;
  }

  queryNodes(
    options: Scope & {
      kind?: string;
      label?: string;
      file?: string;
      provenance?: string;
      search?: string;
      after?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const scope = this.#scope(options);
    const { namespace, end } = scope;
    const clauses = ["repository_id=?"];
    const args: Bind[] = [options.repositoryId];
    if (namespace) {
      clauses.push("id>=? AND id<?");
      args.push(namespace, end);
    } else {
      clauses.push("NOT(id>=? AND id<?)");
      args.push(options.repositoryId + ":graph:", options.repositoryId + ":graph;");
    }
    for (const field of ["kind", "label", "file", "provenance"] as const) {
      if (options[field] !== undefined) {
        clauses.push(`${field}=?`);
        args.push(options[field]!);
      }
    }
    const search = options.search;
    if (search !== undefined) {
      clauses.push("label LIKE ? ESCAPE '\\'");
      args.push(search.replace(/[\\%_]/g, "\\$&") + "%");
    }
    const after = options.after;
    if (after !== undefined) {
      clauses.push("id>?");
      args.push(after);
    }
    args.push(bounded("limit", options.limit, 100, 10000, 1), bounded("offset", options.offset, 0, 1000000));
    return this.db
      .query<NodeRow, Bind[]>(`SELECT * FROM nodes WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ? OFFSET ?`)
      .all(...args);
  }

  neighbors(id: string, options: { direction?: Direction; kind?: string; limit?: number; snapshotId?: string } = {}) {
    const node = this.getNode(id);
    const limit = bounded("limit", options.limit, 100, 10000, 1);
    const selectedDirection = direction(options.direction);
    if (!node) return [];
    const snapshotId = options.snapshotId;
    if (snapshotId !== undefined) {
      const scope = this.#scope({ repositoryId: node.repository_id, snapshotId });
      if (id < scope.namespace! || id >= scope.end!) return [];
    }
    const args: Bind[] = [];
    const kind = options.kind ?? null;
    const branches = (selectedDirection === "both" ? ["outgoing", "incoming"] : [selectedDirection]).map(current => {
      const outgoing = current === "outgoing";
      args.push(node.repository_id, id, kind, kind);
      return `SELECT n.*,e.id AS edge_id,e.kind AS edge_kind,e.provenance AS edge_provenance,e.confidence AS edge_confidence,e.metadata AS edge_metadata,'${current}' AS direction FROM edges e JOIN nodes n ON n.id=e.${outgoing ? "target" : "source"} AND n.repository_id=e.repository_id WHERE e.repository_id=? AND e.${outgoing ? "source" : "target"}=? AND (? IS NULL OR e.kind=?)${selectedDirection === "both" && !outgoing ? " AND e.source<>e.target" : ""}`;
    });
    args.push(limit);
    return this.db
      .query<
        NodeRow & {
          edge_id: string;
          edge_kind: string;
          edge_provenance: string;
          edge_confidence: number;
          edge_metadata: string;
          direction: Direction;
        },
        Bind[]
      >(`${branches.join(" UNION ALL ")} ORDER BY edge_id,direction LIMIT ?`)
      .all(...args);
  }

  incoming(id: string, options: { kind?: string; limit?: number; snapshotId?: string } = {}) {
    return this.neighbors(id, { ...options, direction: "incoming" });
  }
  outgoing(id: string, options: { kind?: string; limit?: number; snapshotId?: string } = {}) {
    return this.neighbors(id, { ...options, direction: "outgoing" });
  }

  async traverse(
    id: string,
    options: {
      direction?: Direction;
      maxDepth?: number;
      nodeLimit?: number;
      workLimit?: number;
      kind?: string;
      signal?: AbortSignal;
    } = {},
  ) {
    const selectedDirection = direction(options.direction);
    const maxDepth = bounded("maxDepth", options.maxDepth, 3, 64);
    const nodeLimit = bounded("nodeLimit", options.nodeLimit, 100, 10000, 1);
    const workLimit = bounded(
      "workLimit",
      options.workLimit,
      Math.min(100000, nodeLimit * Math.max(maxDepth, 1) * 4),
      1000000,
      1,
    );
    const node = this.getNode(id);
    if (!node) return { nodes: [], truncated: false, steps: 0 };
    const visited = new Map([[id, 0]]);
    const kind = options.kind ?? null;
    let frontier = [id],
      steps = 0,
      truncated = false;
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
      options.signal?.throwIfAborted();
      const capacity = nodeLimit - visited.size;
      const remainingWork = workLimit - steps;
      if (remainingWork <= 0) {
        truncated = true;
        break;
      }
      const queueLimit = Math.min(remainingWork, frontier.length + capacity + 1);
      const args: Bind[] = [json(frontier)];
      const visitedJson = json([...visited.keys()]);
      const branches = (selectedDirection === "both" ? ["outgoing", "incoming"] : [selectedDirection]).map(current => {
        const from = current === "outgoing" ? "source" : "target";
        const to = current === "outgoing" ? "target" : "source";
        args.push(
          node.repository_id,
          kind,
          kind,
          visitedJson,
          node.repository_id,
          kind,
          kind,
          visitedJson,
          capacity + 1,
        );
        return `SELECT e.${to},w.depth+1 FROM walk w JOIN edges e ON e.${from}=w.id WHERE e.repository_id=? AND w.depth=0 AND (? IS NULL OR e.kind=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) WHERE value=e.${to}) AND e.id IN (SELECT adjacent.id FROM edges adjacent WHERE adjacent.repository_id=? AND adjacent.${from}=w.id AND (? IS NULL OR adjacent.kind=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) WHERE value=adjacent.${to}) LIMIT ?)`;
      });
      args.push(queueLimit);
      const rows = this.db
        .query<{ id: string; depth: number }, Bind[]>(
          `WITH RECURSIVE walk(id,depth) AS (SELECT value,0 FROM json_each(?) UNION ${branches.join(" UNION ")} ORDER BY 2 LIMIT ?) SELECT * FROM walk ORDER BY depth,id`,
        )
        .all(...args);
      steps += rows.length;
      frontier = [];
      for (const row of rows) {
        const identifier = row.id;
        if (row.depth === 1 && !visited.has(identifier)) {
          if (visited.size >= nodeLimit) {
            truncated = true;
            break;
          }
          visited.set(identifier, depth);
          frontier.push(identifier);
        }
      }
      if (rows.length >= remainingWork) truncated = true;
      if (truncated) break;
      await scheduler.yield();
    }
    options.signal?.throwIfAborted();
    const pairs = [...visited].map(([id, depth]) => ({ id, depth }));
    const result = this.db
      .query<NodeRow & { depth: number }, [string]>(
        `SELECT n.*,json_extract(value,'$.depth') AS depth FROM json_each(?) JOIN nodes n ON n.id=json_extract(value,'$.id') ORDER BY depth,n.id`,
      )
      .all(json(pairs));
    return { nodes: result, truncated, steps };
  }

  lookupFiles(
    repositoryId: string,
    options: {
      path?: string;
      sha256?: string;
      language?: string;
      afterPath?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const clauses = ["repository_id=?"];
    const args: Bind[] = [repositoryId];
    for (const field of ["path", "sha256", "language"] as const)
      if (options[field] !== undefined) {
        clauses.push(`${field}=?`);
        args.push(options[field]!);
      }
    const after = options.afterPath;
    if (after !== undefined) {
      clauses.push("path>?");
      args.push(after);
    }
    args.push(bounded("limit", options.limit, 100, 10000, 1), bounded("offset", options.offset, 0, 1000000));
    return this.db
      .query<FileRow, Bind[]>(`SELECT * FROM files WHERE ${clauses.join(" AND ")} ORDER BY path LIMIT ? OFFSET ?`)
      .all(...args);
  }

  coverage(scope: Scope) {
    const selected = this.#scope(scope);
    const { namespace, end } = selected;
    const suffix = namespace ? " AND id>=? AND id<?" : " AND NOT(id>=? AND id<?)";
    const args: Bind[] = namespace
      ? [scope.repositoryId, namespace, end]
      : [scope.repositoryId, scope.repositoryId + ":graph:", scope.repositoryId + ":graph;"];
    const count = (table: "nodes" | "edges") =>
      this.db
        .query<{ provenance: string; count: number }, Bind[]>(
          `SELECT provenance,count(*) AS count FROM ${table} WHERE repository_id=?${suffix} GROUP BY provenance ORDER BY provenance`,
        )
        .all(...args);
    const nodeCounts = count("nodes"),
      edgeCounts = count("edges");
    return {
      snapshot: selected.snapshot,
      nodes: nodeCounts.reduce((sum, row) => sum + row.count, 0),
      edges: edgeCounts.reduce((sum, row) => sum + row.count, 0),
      nodeProvenance: Object.fromEntries(nodeCounts.map(row => [row.provenance, row.count])),
      edgeProvenance: Object.fromEntries(edgeCounts.map(row => [row.provenance, row.count])),
      unresolvedNodes: nodeCounts.find(row => row.provenance === "UNRESOLVED")?.count ?? 0,
    };
  }

  queryRuns(
    options: {
      kind?: string;
      status?: "running" | "passed" | "failed" | "interrupted";
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const args: Bind[] = [],
      clauses = ["1=1"];
    for (const field of ["kind", "status"] as const)
      if (options[field] !== undefined) {
        clauses.push(`${field}=?`);
        args.push(options[field]!);
      }
    args.push(bounded("limit", options.limit, 100, 10000, 1), bounded("offset", options.offset, 0, 1000000));
    return this.db
      .query<Record<string, unknown>, Bind[]>(
        `SELECT * FROM runs WHERE ${clauses.join(" AND ")} ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...args);
  }

  queryFixes(repositoryId: string, options: { limit?: number; offset?: number } = {}) {
    return this.db
      .query<Record<string, unknown>, Bind[]>(
        "SELECT * FROM fixes WHERE repository_id=? ORDER BY rowid DESC LIMIT ? OFFSET ?",
      )
      .all(repositoryId, bounded("limit", options.limit, 100, 10000, 1), bounded("offset", options.offset, 0, 1000000));
  }

  counts() {
    const count = (table: (typeof tables)[number]) =>
      this.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n;
    return {
      repositories: count("repositories"),
      files: count("files"),
      nodes: count("nodes"),
      edges: count("edges"),
      graph_snapshots: count("graph_snapshots"),
      runs: count("runs"),
      samples: count("samples"),
      fixes: count("fixes"),
      events: count("events"),
      artifacts: count("artifacts"),
    };
  }

  async export(path = this.path === ":memory:" ? undefined : this.path.replace(/\.sqlite$/, ".json")) {
    if (!path) throw new Error("In-memory registries require an explicit export path");
    const target = resolve(path);
    if (target === this.path) throw new Error("JSON export cannot overwrite its SQLite database");
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const writer = Bun.file(temporary).writer();
    using reader =
      this.path === ":memory:"
        ? Database.deserialize(this.db.serialize(), { readonly: true, strict: true })
        : new Database(this.path, { readonly: true, strict: true });
    reader.exec("PRAGMA busy_timeout=30000; BEGIN");
    // A deferred BEGIN takes its snapshot at the first read; take it before the first await.
    reader.query("SELECT count(*) FROM sqlite_schema").get();
    let transaction = true;
    let ended = false;
    let buffered = 0;
    try {
      await writer.write(
        `{"format":"bun_python","schema_version":1,"exported_at":${json(new Date().toISOString())},"tables":{`,
      );
      for (let index = 0; index < tables.length; index++) {
        const table = tables[index]!;
        await writer.write(`${index ? "," : ""}${json(table)}:[`);
        let separator = "";
        for (const row of reader.query(`SELECT * FROM ${table} ORDER BY id`).iterate()) {
          const serialized = separator + json(row);
          const written = writer.write(serialized);
          buffered += typeof written === "number" ? written : await written;
          separator = ",";
          if (buffered >= 1048576) {
            await writer.flush();
            await scheduler.yield();
            buffered = 0;
          }
        }
        await writer.write("]");
      }
      await writer.write("}}\n");
      await writer.end();
      ended = true;
      reader.exec("COMMIT");
      transaction = false;
      renameSync(temporary, target);
      return target;
    } catch (error) {
      if (transaction) reader.exec("ROLLBACK");
      if (!ended) {
        try {
          await writer.end();
        } catch {}
      }
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  [Symbol.dispose]() {
    this.db.close();
  }
}

function executeGraph<R extends GraphRequest>(request: R, options?: { signal?: AbortSignal }) {
  return executeGraphImpl(request, options);
}

function indexCodebase(registry: BunPython, root: string, options: IndexOptions) {
  return indexCodebaseImpl(registry, root, options);
}

export { BunPython, BunPython as PyJS, registryPath, executeGraph, indexCodebase };
export default { BunPython, PyJS: BunPython, registryPath, executeGraph, indexCodebase };
