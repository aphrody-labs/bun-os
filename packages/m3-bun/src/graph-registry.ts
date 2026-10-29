// SPDX-License-Identifier: Apache-2.0
// The build registry of m3-bun: a SQLite file (bun:sqlite) holding repositories (apps), runs (builds) with their
// duration samples and output artifacts, and module-graph snapshots (nodes and links) that can be traversed.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sha256 } from "./util.ts";

export interface GraphDocument {
  nodes: { id: string; label: string; file_type: string; source_file?: string; bytes?: number }[];
  links: { source: string; target: string; relation: string; bytes?: number }[];
}

export interface RegistryNode {
  id: string;
  label: string;
  kind: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, dir TEXT NOT NULL, remote TEXT, metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, argv TEXT NOT NULL, cwd TEXT NOT NULL, metadata TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL DEFAULT 'running', exit_code INTEGER,
  summary TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
  count INTEGER NOT NULL, milliseconds REAL NOT NULL, ref TEXT
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL,
  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL, producer TEXT
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, source_file TEXT, bytes INTEGER
);
CREATE INDEX IF NOT EXISTS nodes_snapshot ON nodes(snapshot_id);
CREATE TABLE IF NOT EXISTS edges (
  snapshot_id TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL, relation TEXT NOT NULL, bytes INTEGER
);
CREATE INDEX IF NOT EXISTS edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS edges_target ON edges(target);
`;

export class GraphRegistry implements Disposable {
  readonly db: Database;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(SCHEMA);
  }

  /** Registers (or refreshes) a repository; the id is `<kind>:<name>`. */
  repository(name: string, kind: string, dir: string, remote: string | null, metadata: object = {}): string {
    const id = `${kind}:${name}`;
    this.db
      .query(
        "INSERT INTO repositories(id, name, kind, dir, remote, metadata) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET dir = excluded.dir, remote = excluded.remote, metadata = excluded.metadata",
      )
      .run(id, name, kind, dir, remote, JSON.stringify(metadata));
    return id;
  }

  startRun(kind: string, argv: string[], cwd: string, metadata: object = {}): string {
    const id = crypto.randomUUID();
    this.db
      .query("INSERT INTO runs(id, kind, argv, cwd, metadata, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, kind, JSON.stringify(argv), cwd, JSON.stringify(metadata), new Date().toISOString());
    return id;
  }

  sample(runId: string, kind: string, label: string, count: number, milliseconds: number, ref?: string): void {
    this.db
      .query("INSERT INTO samples(run_id, kind, label, count, milliseconds, ref) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, kind, label, count, milliseconds, ref ?? null);
  }

  /** Records a file produced by a run, hashed from its bytes. */
  async artifact(path: string, kind: string, runId: string, metadata: object = {}): Promise<void> {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    this.db
      .query("INSERT INTO artifacts(run_id, kind, path, sha256, bytes, metadata) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, kind, path, sha256(bytes), bytes.length, JSON.stringify(metadata));
  }

  finishRun(runId: string, exitCode: number, summary = "", error?: string): void {
    this.db
      .query("UPDATE runs SET finished_at = ?, status = ?, exit_code = ?, summary = ?, error = ? WHERE id = ?")
      .run(new Date().toISOString(), exitCode === 0 ? "passed" : "failed", exitCode, summary, error ?? null, runId);
  }

  queryRuns(filter: { kind?: string } = {}): { id: string; kind: string; status: string; summary: string | null }[] {
    return this.db
      .query<{ id: string; kind: string; status: string; summary: string | null }, [string | null]>(
        "SELECT id, kind, status, summary FROM runs WHERE (?1 IS NULL OR kind = ?1) ORDER BY started_at, rowid",
      )
      .all(filter.kind ?? null);
  }

  /** Stores a module graph as the snapshot `<repository>:graph:<hash>`; importing the same hash again is a no-op. */
  async importGraph(repositoryId: string, graph: GraphDocument, hash: string): Promise<{ nodes: number; edges: number }> {
    const snapshotId = `${repositoryId}:graph:${hash}`;
    const insertNodes = this.db.transaction(() => {
      this.db.query("DELETE FROM nodes WHERE snapshot_id = ?").run(snapshotId);
      this.db.query("DELETE FROM edges WHERE snapshot_id = ?").run(snapshotId);
      this.db.query("DELETE FROM snapshots WHERE id = ?").run(snapshotId);
      this.db
        .query("INSERT INTO snapshots(id, repository_id, hash, created_at, producer) VALUES (?, ?, ?, ?, ?)")
        .run(snapshotId, repositoryId, hash, new Date().toISOString(), (graph as { producer?: string }).producer ?? null);
      const node = this.db.query(
        "INSERT INTO nodes(id, snapshot_id, label, kind, source_file, bytes) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const entry of graph.nodes)
        node.run(`${snapshotId}:${entry.id}`, snapshotId, entry.label, entry.file_type, entry.source_file ?? null, entry.bytes ?? null);
      const edge = this.db.query(
        "INSERT INTO edges(snapshot_id, source, target, relation, bytes) VALUES (?, ?, ?, ?, ?)",
      );
      for (const link of graph.links)
        edge.run(snapshotId, `${snapshotId}:${link.source}`, `${snapshotId}:${link.target}`, link.relation, link.bytes ?? null);
    });
    insertNodes();
    return { nodes: graph.nodes.length, edges: graph.links.length };
  }

  /** The most recent snapshot of a repository. */
  getSnapshot(repositoryId: string): { id: string; hash: string; createdAt: string } | null {
    return this.db
      .query<{ id: string; hash: string; createdAt: string }, [string]>(
        "SELECT id, hash, created_at AS createdAt FROM snapshots WHERE repository_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(repositoryId);
  }

  getNode(id: string): RegistryNode | null {
    return this.db.query<RegistryNode, [string]>("SELECT id, label, kind FROM nodes WHERE id = ?").get(id);
  }

  /** Breadth-first walk from a node along incoming or outgoing links, optionally only one relation. */
  traverse(
    start: string,
    options: { direction: "incoming" | "outgoing"; kind?: string; maxDepth?: number },
  ): { nodes: (RegistryNode & { depth: number })[] } {
    const [from, to] = options.direction === "incoming" ? ["target", "source"] : ["source", "target"];
    const query = this.db.query<{ next: string }, [string, string | null]>(
      `SELECT ${to} AS next FROM edges WHERE ${from} = ?1 AND (?2 IS NULL OR relation = ?2)`,
    );
    const depths = new Map<string, number>([[start, 0]]);
    let frontier = [start];
    for (let depth = 1; depth <= (options.maxDepth ?? 32) && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const row of query.all(id, options.kind ?? null))
          if (!depths.has(row.next)) {
            depths.set(row.next, depth);
            next.push(row.next);
          }
      frontier = next;
    }
    const nodes = [...depths].flatMap(([id, depth]) => {
      const node = this.getNode(id);
      return node ? [{ ...node, depth }] : [];
    });
    return { nodes };
  }

  queryNodes(filter: { repositoryId: string; limit?: number }): RegistryNode[] {
    const snapshot = this.getSnapshot(filter.repositoryId);
    if (!snapshot) return [];
    return this.db
      .query<RegistryNode, [string, number]>("SELECT id, label, kind FROM nodes WHERE snapshot_id = ? ORDER BY label LIMIT ?")
      .all(snapshot.id, filter.limit ?? 500);
  }

  coverage(filter: { repositoryId: string }): {
    snapshot: { id: string } | null;
    nodes: number;
    edges: number;
    unresolvedNodes: number;
  } {
    const snapshot = this.getSnapshot(filter.repositoryId);
    if (!snapshot) return { snapshot: null, nodes: 0, edges: 0, unresolvedNodes: 0 };
    const count = (sql: string) => this.db.query<{ n: number }, [string]>(sql).get(snapshot.id)!.n;
    return {
      snapshot,
      nodes: count("SELECT count(*) AS n FROM nodes WHERE snapshot_id = ?"),
      edges: count("SELECT count(*) AS n FROM edges WHERE snapshot_id = ?"),
      // An edge target that is not a node of the snapshot.
      unresolvedNodes: count(
        "SELECT count(*) AS n FROM edges WHERE snapshot_id = ? AND target NOT IN (SELECT id FROM nodes)",
      ),
    };
  }

  /** A markdown report of one repository: its latest snapshot, its runs and its largest outputs. */
  markdown(repositoryId: string): string {
    const lines = [`# Build graph of ${repositoryId}`, ""];
    const coverage = this.coverage({ repositoryId });
    if (!coverage.snapshot) return [...lines, "No build recorded.", ""].join("\n");
    lines.push(`Snapshot \`${coverage.snapshot.id}\`: ${coverage.nodes} nodes, ${coverage.edges} links.`, "", "## Runs", "");
    for (const run of this.queryRuns({ kind: "m3-bun.build" }))
      lines.push(`- ${run.status}: ${run.summary ?? ""}`.trimEnd());
    lines.push("", "## Largest outputs", "");
    const outputs = this.db
      .query<{ label: string; bytes: number }, [string]>(
        "SELECT label, bytes FROM nodes WHERE snapshot_id = ? AND kind = 'output' ORDER BY bytes DESC LIMIT 10",
      )
      .all(coverage.snapshot.id);
    for (const output of outputs) lines.push(`- \`${output.label}\`: ${output.bytes} bytes`);
    lines.push("");
    return lines.join("\n");
  }

  close(): void {
    this.db.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
