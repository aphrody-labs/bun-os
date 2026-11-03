// SPDX-License-Identifier: Apache-2.0
// Types of the migrated `bun:graph-native`, `bun:graph-index` and `bun:graph` APIs (aphrody-labs/bun fork
// packages/bun-types/graph*.d.ts), as module exports for upstream Bun.
export interface GraphScope {
  source: `graph:${string}`;
  profile: string;
}
export interface GraphLimits {
  max_files?: number;
  max_file_bytes?: number;
  max_source_bytes?: number;
  max_nodes?: number;
  max_edges?: number;
  max_ast_depth?: number;
  max_output_bytes?: number;
}
export type GraphConfidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
/** Accepted input; omitted fields receive defaults in the Rust deserializer. */
export interface GraphNodeInput {
  id: string;
  label: string;
  file_type?: "code" | "document" | "concept" | "rationale";
  source_file?: string | null;
  source_location?: string | null;
  lang?: string | null;
  community?: number | null;
  community_name?: string | null;
  package?: string | null;
}
/** Rust serializes every field, including absent metadata as null. */
export interface GraphNode extends GraphNodeInput {
  file_type: "code" | "document" | "concept" | "rationale";
  source_file: string | null;
  source_location: string | null;
  lang: string | null;
  community: number | null;
  community_name: string | null;
  package: string | null;
}
export interface GraphLinkInput {
  source: string;
  target: string;
  relation: string;
  confidence: GraphConfidence;
  confidence_score?: number;
  weight?: number;
  source_file?: string | null;
  source_location?: string | null;
  context?: string | null;
}
export interface GraphLink extends GraphLinkInput {
  confidence_score: number;
  weight: number;
  source_file: string | null;
  source_location: string | null;
  context: string | null;
}
export interface GraphDocument {
  nodes: GraphNode[];
  links: GraphLink[];
  root: string | null;
  built_at_commit: string | null;
}
export type GraphInput = {
  nodes: GraphNodeInput[];
  root?: string | null;
  built_at_commit?: string | null;
} & ({ links: GraphLinkInput[]; edges?: never } | { edges: GraphLinkInput[]; links?: never });
export interface GraphSourceFile {
  path: string;
  content: string;
}
export interface GraphPackages {
  package_of?: Record<string, string>;
  package_dir?: Record<string, string>;
}
export interface GraphRequestBase {
  scope: GraphScope;
  limits?: GraphLimits;
}
export type GraphOperation =
  | {
      op: "build";
      files: GraphSourceFile[];
      packages?: GraphPackages;
      root?: string | null;
      built_at_commit?: string | null;
    }
  | {
      op: "query";
      graph: GraphInput;
      question: string;
      depth?: number;
      budget_tokens?: number;
      starts?: number;
      relations?: string[];
    }
  | { op: "path"; graph: GraphInput; from: string; to: string; directed?: boolean; relations?: string[] }
  | { op: "explain"; graph: GraphInput; node: string }
  | { op: "analyze"; graph: GraphInput; top?: number }
  | { op: "export"; graph: GraphInput };
export type GraphRequest = GraphRequestBase & GraphOperation;
export interface GraphBuildStats {
  calls: number;
  same_file: number;
  cross_file: number;
  external: number;
  unresolved: number;
  stubs_folded: number;
  imports_resolved: number;
  imports_external: number;
}
export interface GraphPathHop {
  node: string;
  edge: GraphLink | null;
  forward: boolean | null;
}
export interface GraphExplanation {
  label: string;
  id: string;
  source: string | null;
  kind: string;
  package: string | null;
  community: string | null;
  degree: number;
  connections: {
    direction: "incoming" | "outgoing";
    other: string;
    relation: string;
    confidence: GraphConfidence;
    at: string | null;
  }[];
}
export interface GraphResultMap {
  build: {
    op: "build";
    graph: GraphDocument;
    stats: GraphBuildStats;
    parse_errors: { path: string; error: string }[];
  };
  query: { op: "query"; graph: GraphDocument; starts: string[]; truncated: number; text: string };
  path: { op: "path"; hops: GraphPathHop[] | null };
  explain: { op: "explain"; explanation: GraphExplanation };
  analyze: { op: "analyze"; graph: GraphDocument; modularity: number; god_nodes: { id: string; degree: number }[] };
  export: { op: "export"; graph: GraphDocument };
}
export interface GraphResponse<R extends GraphRequest = GraphRequest> {
  scope: GraphScope;
  result: GraphResultMap[R["op"]];
}
export interface GitSourceFile {
  path: string;
  mode: "100644" | "100755" | "120000" | "160000";
  bytes: number;
  gitBlob: string;
  sha256?: string | null;
}
export interface GitIndexInput {
  kind: "git";
  repository: "oven-sh/bun" | "aphrody-labs/bun";
  revision: string;
  files: AsyncIterable<GitSourceFile>;
  /** Bounded immutable blob bytes; the frontend verifies the Git object identity and size. */
  readFile(file: GitSourceFile, signal?: AbortSignal): Promise<Uint8Array>;
}
export interface IndexOptions {
  /** Pinned Git input ignores the mutable working tree and defaults to all tracked paths. */
  input?: GitIndexInput;
  profile: "bun";
  /** Namespaces source IDs and repository IDs so several owners can share one registry. */
  namespace?: string;
  signal?: AbortSignal;
  revision?: string;
  concurrency?: number;
  /** Repository-relative, real directory roots to scan; defaults to `src` and `packages`. */
  surfaces?: string[];
  /** Repository-relative paths to omit, including all descendants. */
  excludePaths?: string[];
  domains?: string[];
  artifactDirectory?: string;
  maxFiles?: number;
  maxReadBytes?: number;
  maxFileBytes?: number;
  maxAstDepth?: number;
  filesPerChunk?: number;
  sourceBytesPerChunk?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxSnapshotBytes?: number;
}
export interface IndexCoverage {
  files: number;
  nativeFiles: number;
  unresolvedFiles: number;
  metadataOnlyFiles: number;
  chunks: number;
  parseErrors: number;
  /** Symbol IDs that collide across files and were kept unresolved rather than discarded. */
  symbolIdCollisions: number;
  calls: number;
  unresolvedCalls: number;
  sourceBytes: number;
  hashedSourceBytes: number;
  resolutionScope: "domain-chunk";
}
export interface DomainResult {
  domain: string;
  surface: string;
  repository: string;
  source: `graph:${string}`;
  snapshot: string;
  sha256: string;
  inputSHA256: string;
  cached: boolean;
  nodes: number;
  edges: number;
  coverage: IndexCoverage;
  artifact?: string;
}
export interface IndexResult {
  root: string;
  profile: "bun";
  namespace: string;
  surfaces: string[];
  revision: string;
  dirty: boolean | null;
  producerSHA256: string;
  domains: DomainResult[];
  input?: {
    kind: "git";
    repository: string;
    revision: string;
    files: number;
    selectedFiles: number;
    fileCoverageComplete: boolean;
  };
}
export interface RegistryNode {
  id: string;
  repository_id: string;
  kind: string;
  label: string;
  file: string | null;
  line: number | null;
  provenance: string;
  metadata: string;
}
export interface GraphSnapshot {
  id: string;
  repository_id: string;
  producer: string;
  revision: string | null;
  sha256: string;
  created_at: string;
  metadata: string;
}
export interface GraphFile {
  id: string;
  repository_id: string;
  path: string;
  sha256: string;
  language: string;
  bytes: number;
  metadata: string;
}
export type GraphDirection = "incoming" | "outgoing" | "both";
export interface GraphNeighbor extends RegistryNode {
  edge_id: string;
  edge_kind: string;
  edge_provenance: string;
  edge_confidence: number;
  edge_metadata: string;
  direction: GraphDirection;
}
export interface GraphPage {
  limit?: number;
  offset?: number;
}
export interface RegistryScope {
  repositoryId: string;
  snapshotId?: string;
}
export interface GraphAdjacent {
  kind?: string;
  limit?: number;
  snapshotId?: string;
}
