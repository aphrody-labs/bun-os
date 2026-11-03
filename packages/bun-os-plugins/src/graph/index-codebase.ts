// SPDX-License-Identifier: Apache-2.0
// `bun:graph-index` of the aphrody-labs/bun fork (src/js/bun/graph-index.ts) on upstream Bun: indexes explicit
// source domains into the BunPython registry with the native Rust extraction of crates/aphrody-code-graph.
// The producer hash names the graph engine that produced the facts: the `aphrody-graph` executable (the fork
// hashed its own bun binary, which embedded the engine).
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { scheduler } from "node:timers/promises";
import { executeGraph, graphBinary } from "./native.ts";
import type { BunPython as Registry } from "./registry.ts";
import type {
  DomainResult,
  GitSourceFile,
  GraphResultMap,
  GraphSourceFile as SourceFile,
  IndexCoverage as Coverage,
  IndexOptions,
  IndexResult,
} from "./types.ts";
type BuildResponse = GraphResultMap["build"];

const FORMAT_VERSION = 2;
const nativeExtensions = new Set(["rs", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "md", "mdx"]);
const textExtensions = new Set([
  ...nativeExtensions,
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "py",
  "pyi",
  "zig",
  "json",
  "jsonc",
  "toml",
  "yaml",
  "yml",
  "txt",
  "html",
  "css",
  "scss",
  "sh",
  "ps1",
  "bat",
  "cmd",
  "xml",
  "svg",
  "csv",
  "ini",
  "cmake",
  "s",
  "asm",
  "m",
  "mm",
  "inc",
  "def",
  "lock",
  "bzl",
  "gyp",
  "gypi",
  "proto",
  "rc",
]);
const protectedParts = new Set([
  ".git",
  ".coord",
  ".aphrody",
  ".codex",
  ".claude",
  "cookies",
  "credentials",
  "secrets",
  "sessions",
  "models",
  "weights",
  "node_modules",
  "target",
  ".cache",
  "__pycache__",
  ".venv",
]);
let producer: Promise<string> | undefined;

type FileRecord = {
  git?: GitSourceFile;
  absolute: string;
  path: string;
  bytes: number;
  mtime: number;
  sha256: string | null;
  native: boolean;
  readable: boolean;
  reason: string | null;
};
type Domain = { name: string; root: string; surface: string; files: FileRecord[] };
type RecordNode = Record<string, unknown> & { id: string };
type RecordEdge = Record<string, unknown> & { source: string; target: string };

function bound(value: number | undefined, fallback: number, max: number, name: string, min = 1) {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  return number;
}

function contained(root: string, file: string) {
  const path = relative(root, file);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

async function canonicalDestination(path: string, signal?: AbortSignal) {
  const pending: string[] = [];
  let ancestor = path;
  while (true) {
    signal?.throwIfAborted();
    try {
      return resolve(await realpath(ancestor), ...pending.toReversed());
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      pending.push(relative(parent, ancestor));
      ancestor = parent;
    }
  }
}

function canonical(path: string) {
  return path.split(sep).join("/");
}

function normalized(path: string) {
  return Array.from(path, character => character.toLowerCase())
    .join("")
    .replace(/[^\p{Alphabetic}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function validateRelativePath(value: string, name: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.split("/").some(part => part === "" || part === "." || part === "..")
  )
    throw new TypeError(`${name} must be a normalized relative path`);
  return value;
}

async function hashFile(
  path: string,
  signal?: AbortSignal,
  maxBytes = Number.MAX_SAFE_INTEGER,
  text?: { valid: boolean },
) {
  const hash = new Bun.CryptoHasher("sha256");
  const decoder = text ? new TextDecoder("utf-8", { fatal: true }) : null;
  let bytes = 0;
  for await (const chunk of Bun.file(path).stream()) {
    signal?.throwIfAborted();
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new RangeError("Source changed beyond the read byte limit");
    hash.update(chunk);
    if (text?.valid) {
      try {
        decoder!.decode(chunk, { stream: true });
      } catch {
        text.valid = false;
      }
    }
  }
  if (text?.valid) {
    try {
      decoder!.decode();
    } catch {
      text.valid = false;
    }
  }
  return hash.digest("hex");
}

async function revisionAt(root: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await using child = Bun.spawn({
    cmd: ["git", "-C", root, "rev-parse", "--verify", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
    ...(signal ? { signal } : {}),
  });
  const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  signal?.throwIfAborted();
  return code === 0 && /^[a-f\d]{40,64}$/i.test(text.trim()) ? text.trim() : null;
}

async function dirtyAt(root: string, surfaces: string[], signal?: AbortSignal): Promise<boolean | null> {
  signal?.throwIfAborted();
  await using child = Bun.spawn({
    cmd: ["git", "-C", root, "status", "--porcelain=v1", "--untracked-files=normal", "--", ...surfaces],
    stdout: "pipe",
    stderr: "ignore",
    ...(signal ? { signal } : {}),
  });
  let dirty = false;
  for await (const chunk of child.stdout) {
    signal?.throwIfAborted();
    dirty ||= chunk.byteLength > 0;
  }
  const code = await child.exited;
  return code === 0 ? dirty : null;
}

async function parallel<T, R>(
  values: T[],
  count: number,
  signal: AbortSignal | undefined,
  work: (value: T) => Promise<R>,
) {
  let next = 0;
  let failed = false;
  const results: R[] = [];
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(values.length, count) }, async () => {
      try {
        while (!failed && next < values.length) {
          signal?.throwIfAborted();
          const index = next++;
          results[index] = await work(values[index]!);
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }),
  );
  for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
  return results;
}

function metadataNode(file: FileRecord): RecordNode {
  return {
    id: `file:${file.path}`,
    kind: "file",
    file_type: "file",
    label: file.path,
    source_file: file.path,
    source_location: "L1",
    sha256: file.sha256,
    bytes: file.bytes,
    provenance: file.native && !file.reason ? "EXTRACTED" : "UNRESOLVED",
    hashKind: file.sha256 ? "content-sha256" : "metadata-only",
    unresolvedReason: file.reason,
    ...(file.git ? { gitBlob: file.git.gitBlob, gitMode: file.git.mode, gitPath: file.git.path } : {}),
  };
}

async function writeGraph(
  path: string,
  nodes: Map<string, RecordNode>,
  edges: RecordEdge[],
  metadata: Record<string, unknown>,
  revision: string,
  limit: number,
  signal?: AbortSignal,
) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const writer = Bun.file(temporary).writer();
  const digest = new Bun.CryptoHasher("sha256");
  let bytes = 0,
    pending = 0,
    ended = false;
  async function write(text: string) {
    signal?.throwIfAborted();
    const length = Buffer.byteLength(text);
    bytes += length;
    if (bytes > limit) throw new RangeError("Graph snapshot exceeds maxSnapshotBytes");
    digest.update(text);
    const count = writer.write(text);
    if (typeof count !== "number") await count;
    pending += length;
    if (pending >= 65536) {
      await writer.flush();
      pending = 0;
      await scheduler.yield();
    }
  }
  try {
    await write(
      `{"producer":"bun native graph index","directed":true,"multigraph":true,"graph":${JSON.stringify(metadata)},"built_at_commit":${JSON.stringify(revision)},"nodes":[`,
    );
    let count = 0;
    for (const node of nodes.values()) await write((count++ ? "," : "") + JSON.stringify(node));
    await write('],"links":[');
    count = 0;
    for (const edge of edges) await write((count++ ? "," : "") + JSON.stringify(edge));
    await write("]}");
    await writer.end();
    ended = true;
    signal?.throwIfAborted();
    const sha256 = digest.digest("hex");
    const target = `${path}.${sha256}.json`;
    await rename(temporary, target);
    return { path: target, sha256, bytes };
  } catch (error) {
    if (!ended) {
      try {
        await writer.end();
      } catch {}
    }
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function scan(root: string, options: IndexOptions, maxFiles: number, maxReadBytes: number) {
  const domains = new Map<string, Domain>();
  const requested = options.domains ? new Set(options.domains) : undefined;
  const surfaces = options.surfaces ?? ["src", "packages"];
  if (!Array.isArray(surfaces) || surfaces.length === 0 || surfaces.length > 1024)
    throw new TypeError("surfaces must contain between 1 and 1024 relative directory paths");
  for (const surface of surfaces) validateRelativePath(surface, "surface");
  if (new Set(surfaces).size !== surfaces.length) throw new TypeError("surfaces cannot contain duplicates");
  for (const left of surfaces)
    for (const right of surfaces)
      if (left !== right && right.startsWith(`${left}/`))
        throw new TypeError(`Overlapping source surfaces: ${left} and ${right}`);
  const excluded = (options.excludePaths ?? []).map(path => validateRelativePath(path, "excludePath"));
  if (excluded.length > 4096 || new Set(excluded).size !== excluded.length)
    throw new TypeError("excludePaths must contain unique paths (maximum 4096)");
  let scanned = 0;
  for (const surface of surfaces) {
    const directory = resolve(root, ...surface.split("/"));
    const info = await lstat(directory).catch(error => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Index surface must be a real directory: ${surface}`);
    if (!contained(root, await realpath(directory)))
      throw new Error(`Index surface escapes repository root: ${surface}`);
    for await (const path of new Bun.Glob("**/*").scan({
      cwd: directory,
      onlyFiles: true,
      dot: true,
      followSymlinks: false,
    })) {
      options.signal?.throwIfAborted();
      const parts = canonical(path).split("/");
      const absolute = resolve(directory, path);
      const relativePath = canonical(relative(root, absolute));
      if (excluded.some(exclude => relativePath === exclude || relativePath.startsWith(`${exclude}/`))) continue;
      const name = parts.length > 1 ? `${surface}/${parts[0]}` : surface;
      if (requested && !requested.has(name)) continue;
      if (++scanned > maxFiles) throw new RangeError("Source index exceeds maxFiles");
      if (!contained(root, absolute)) throw new Error("Source index path escapes root");
      const stat = await lstat(absolute);
      const domainRoot = parts.length > 1 ? join(directory, parts[0]!) : directory;
      const filePath = canonical(relative(domainRoot, absolute));
      const extension = extname(filePath).slice(1).toLowerCase();
      const protectedPath =
        relativePath.split("/").some(part => protectedParts.has(part.toLowerCase())) ||
        /(^|\/)(?:\.env(?:\.|$)|.*\.(?:pem|key|pfx|p12)$)/i.test(filePath);
      const readable =
        !protectedPath &&
        !stat.isSymbolicLink() &&
        stat.isFile() &&
        stat.size <= maxReadBytes &&
        gitTextFile(filePath, extension);
      const native = readable && nativeExtensions.has(extension);
      let reason = stat.isSymbolicLink()
        ? "symlink-metadata-only"
        : protectedPath
          ? "protected-metadata-only"
          : !readable
            ? "binary-or-size-metadata-only"
            : !native
              ? "unsupported-native-format"
              : null;
      if (!stat.isSymbolicLink() && !contained(root, await realpath(absolute))) {
        reason = "external-metadata-only";
      }
      let domain = domains.get(name);
      if (!domain) domains.set(name, (domain = { name, root: domainRoot, surface, files: [] }));
      domain.files.push({
        absolute,
        path: filePath,
        bytes: stat.size,
        mtime: stat.mtimeMs,
        sha256: null,
        native: native && reason === null,
        readable: readable && reason !== "external-metadata-only",
        reason,
      });
      if (scanned % 1000 === 0) await scheduler.yield();
    }
  }
  if (requested)
    for (const name of requested) if (!domains.has(name)) throw new Error(`Unknown or empty source domain ${name}`);
  return [...domains.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function gitTextFile(path: string, extension: string) {
  return (
    textExtensions.has(extension) ||
    /(^|\/)(?:LICENSE(?:-[\w.-]+)?|NOTICE|Makefile|BunMakefile|Dockerfile|CMakeLists\.txt|BUILD\.bazel)$/i.test(path)
  );
}
async function gitDomains(root: string, options: IndexOptions, maxFiles: number, maxReadBytes: number) {
  const input = options.input!;
  if (
    input.kind !== "git" ||
    !["oven-sh/bun", "aphrody-labs/bun"].includes(input.repository) ||
    !/^[a-f0-9]{40}$/.test(input.revision) ||
    typeof input.readFile !== "function" ||
    !input.files?.[Symbol.asyncIterator]
  )
    throw new TypeError("Pinned public Bun Git input is invalid");
  const domains = new Map<string, Domain>(),
    paths = new Set<string>();
  const requested = options.domains ? new Set(options.domains) : undefined;
  let total = 0,
    selected = 0;
  for await (const file of input.files) {
    options.signal?.throwIfAborted();
    validateRelativePath(file.path, "Git path");
    if (++total > maxFiles || paths.has(file.path))
      throw new RangeError("Git input exceeds maxFiles or repeats a path");
    paths.add(file.path);
    if (
      !["100644", "100755", "120000", "160000"].includes(file.mode) ||
      !/^[a-f0-9]{40}$/.test(file.gitBlob) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      (file.sha256 != null && !/^[a-f0-9]{64}$/.test(file.sha256))
    )
      throw new TypeError("Invalid pinned Git file descriptor");
    if ((options.excludePaths ?? []).some(path => file.path === path || file.path.startsWith(path + "/"))) continue;
    if (options.surfaces && !options.surfaces.some(path => file.path.startsWith(path + "/"))) continue;
    const parts = file.path.split("/");
    const surface = parts.length === 1 ? "root" : parts[0]!;
    const name = parts.length > 2 ? parts.slice(0, 2).join("/") : surface;
    if (requested && !requested.has(name)) continue;
    const prefix = name === "root" ? "" : name + "/";
    const path = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
    const extension = extname(path).slice(1).toLowerCase();
    // Public committed skills are authorized source; filesystem scans and provider stores remain protected.
    const publicSkill = /(^|\/)\.(?:claude|codex|agents)\/skills\//i.test(file.path);
    const protectedPath =
      (!publicSkill && parts.some(part => protectedParts.has(part.toLowerCase()))) ||
      /(^|\/)(?:\.env(?:\.|$)|.*\.(?:pem|key|pfx|p12)$)/i.test(file.path);
    const regular = file.mode === "100644" || file.mode === "100755";
    const readable = regular && !protectedPath && file.bytes <= maxReadBytes && gitTextFile(path, extension);
    const native = readable && nativeExtensions.has(extension);
    const reason = !regular
      ? file.mode === "160000"
        ? "gitlink-metadata-only"
        : "symlink-metadata-only"
      : protectedPath
        ? "protected-metadata-only"
        : !readable
          ? "binary-or-size-metadata-only"
          : !native
            ? "unsupported-native-format"
            : null;
    let domain = domains.get(name);
    if (!domain)
      domains.set(
        name,
        (domain = { name, root: join(root, ...(name === "root" ? [] : name.split("/"))), surface, files: [] }),
      );
    domain.files.push({
      absolute: join(root, ...file.path.split("/")),
      path,
      bytes: file.bytes,
      mtime: 0,
      sha256: file.sha256 ?? null,
      native,
      readable,
      reason,
      git: Object.freeze({ ...file }),
    });
    selected++;
    if (total % 1000 === 0) await scheduler.yield();
  }
  if (!total) throw new Error("Pinned Git input is empty");
  if (requested)
    for (const domain of requested) if (!domains.has(domain)) throw new Error("Unknown Git source domain " + domain);
  return { domains: [...domains.values()].sort((a, b) => a.name.localeCompare(b.name, "en")), total, selected };
}
async function gitBytes(file: FileRecord, options: IndexOptions) {
  const input = options.input!;
  const git = file.git!;
  const bytes = await input.readFile(git, options.signal);
  if (
    bytes.length !== file.bytes ||
    bytes.length > (options.maxReadBytes ?? 16 * 1024 * 1024) ||
    new Bun.CryptoHasher("sha1")
      .update("blob " + file.bytes + "\0")
      .update(bytes)
      .digest("hex") !== git.gitBlob
  )
    throw new Error("Pinned Git blob size or identity changed: " + git.path);
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (file.sha256 && actual !== file.sha256) throw new Error("Pinned Git SHA-256 mismatch: " + git.path);
  return { bytes, sha256: actual };
}

async function indexDomain(
  registry: Registry,
  domain: Domain,
  revision: string,
  options: IndexOptions,
  producerSHA256: string,
  artifactDirectory: string,
  dirty: boolean | null,
  sourceRoot: string,
): Promise<DomainResult> {
  const signal = options.signal;
  const filesPerChunk = bound(options.filesPerChunk, 4096, 4096, "filesPerChunk");
  const sourceBytesPerChunk = bound(
    options.sourceBytesPerChunk,
    32 * 1024 * 1024,
    32 * 1024 * 1024,
    "sourceBytesPerChunk",
  );
  const maxFileBytes = bound(options.maxFileBytes, 1024 * 1024, 16 * 1024 * 1024, "maxFileBytes");
  const maxAstDepth = bound(options.maxAstDepth, 128, 256, "maxAstDepth");
  const maxNodes = bound(options.maxNodes, 250_000, 2_000_000, "maxNodes");
  const maxEdges = bound(options.maxEdges, 1_000_000, 4_000_000, "maxEdges");
  const maxSnapshotBytes = bound(options.maxSnapshotBytes, 512 * 1024 * 1024, 512 * 1024 * 1024, "maxSnapshotBytes");
  const namespace = options.namespace ?? "bun";
  const scope = {
    profile: "bun",
    source: `graph:${namespace}:${domain.name.replaceAll("/", ":")}` as `graph:${string}`,
  };
  const coverage: Coverage = {
    files: domain.files.length,
    nativeFiles: 0,
    unresolvedFiles: 0,
    metadataOnlyFiles: 0,
    chunks: 0,
    parseErrors: 0,
    symbolIdCollisions: 0,
    calls: 0,
    unresolvedCalls: 0,
    sourceBytes: 0,
    hashedSourceBytes: 0,
    resolutionScope: "domain-chunk",
  };
  domain.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const stems = new Map<string, FileRecord[]>();
  for (const file of domain.files) {
    signal?.throwIfAborted();
    if (file.readable && file.git) {
      const content = await gitBytes(file, options);
      file.sha256 = content.sha256;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(content.bytes);
        coverage.hashedSourceBytes += file.bytes;
      } catch {
        file.sha256 = null;
        file.native = false;
        file.readable = false;
        file.reason = "invalid-utf8-metadata-only";
        coverage.parseErrors++;
      }
    } else if (file.readable) {
      const before = await lstat(file.absolute);
      if (before.isSymbolicLink() || !before.isFile() || !contained(sourceRoot, await realpath(file.absolute)))
        throw new Error(`Source path changed before hashing: ${file.path}`);
      const text = { valid: true };
      file.sha256 = await hashFile(file.absolute, signal, options.maxReadBytes ?? 16 * 1024 * 1024, text);
      const after = await lstat(file.absolute);
      if (after.isSymbolicLink() || after.size !== file.bytes || after.mtimeMs !== file.mtime)
        throw new Error(`Source changed while hashing: ${file.path}`);
      if (text.valid) coverage.hashedSourceBytes += file.bytes;
      else {
        file.sha256 = null;
        file.native = false;
        file.readable = false;
        file.reason = "invalid-utf8-metadata-only";
        coverage.parseErrors++;
      }
    }
    coverage.sourceBytes += file.bytes;
    if (file.native && file.bytes > Math.min(maxFileBytes, sourceBytesPerChunk)) {
      file.native = false;
      file.reason = "native-file-byte-limit";
    }
    if (file.native) {
      const stem = normalized(file.path.slice(0, -extname(file.path).length));
      const group = stems.get(stem);
      if (group) group.push(file);
      else stems.set(stem, [file]);
    }
  }
  for (const group of stems.values())
    if (group.length > 1)
      for (const file of group) {
        file.native = false;
        file.reason = "native-id-normalization-collision";
      }
  const digest = new Bun.CryptoHasher("sha256").update(
    JSON.stringify({
      version: FORMAT_VERSION,
      scope,
      domain: domain.name,
      revision,
      producerSHA256,
      filesPerChunk,
      sourceBytesPerChunk,
      maxFileBytes,
      maxAstDepth,
      maxNodes,
      maxEdges,
      ...(options.input ? { inputKind: "git", inputRepository: options.input.repository } : {}),
    }),
  );
  for (const file of domain.files)
    digest.update(
      JSON.stringify([
        file.path,
        file.sha256,
        file.bytes,
        file.sha256 ? null : file.mtime,
        file.reason,
        ...(file.git ? [file.git.gitBlob, file.git.mode] : []),
      ]) + "\n",
    );
  const inputSHA256 = digest.digest("hex");
  const repository = registry.repository(`${namespace}/${domain.name}`, "source", domain.root, revision, {
    domain: domain.name,
    profile: "bun",
    source: scope.source,
    surface: domain.surface,
    dirty,
    dirtyScope: options.input ? "pinned-git-snapshot" : options.surfaces ? "selected-surfaces" : "src-and-packages",
    dirtySurfaces: options.input ? (options.surfaces ?? ["all-git-paths"]) : (options.surfaces ?? ["src", "packages"]),
  });
  const insert = registry.db.query(
    "INSERT INTO files VALUES(?,?,?,?,?,?,?) ON CONFLICT(repository_id,path) DO UPDATE SET sha256=excluded.sha256,language=excluded.language,bytes=excluded.bytes,metadata=excluded.metadata",
  );
  for (let start = 0; start < domain.files.length; start += 1000) {
    signal?.throwIfAborted();
    registry.db.transaction(() => {
      for (const file of domain.files.slice(start, start + 1000))
        insert.run(
          `${repository}:${file.path}`,
          repository,
          file.path,
          file.sha256 ?? "metadata-only",
          extname(file.path).slice(1) || "text",
          file.bytes,
          JSON.stringify({
            revision,
            hashKind: file.sha256 ? "content-sha256" : "metadata-only",
            reason: file.reason,
          }),
        );
    })();
    await scheduler.yield();
  }
  const cached = registry.db
    .query<{ id: string; sha256: string; metadata: string }, [string, string]>(
      "SELECT id,sha256,metadata FROM graph_snapshots WHERE repository_id=? AND json_extract(metadata,'$.graph.inputSHA256')=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(repository, inputSHA256);
  if (cached) {
    const previous = JSON.parse(cached.metadata);
    registry.repository(`${namespace}/${domain.name}`, "source", domain.root, revision, {
      coverage: previous.graph.coverage,
      dirty,
    });
    return {
      domain: domain.name,
      surface: domain.surface,
      repository,
      source: scope.source,
      snapshot: cached.id,
      sha256: cached.sha256,
      inputSHA256,
      cached: true,
      nodes: previous.nodes,
      edges: previous.edges,
      coverage: previous.graph.coverage,
    };
  }
  const nodes = new Map<string, RecordNode>(domain.files.map(file => [`file:${file.path}`, metadataNode(file)]));
  const edges: RecordEdge[] = [];
  const edgeKeys = new Set<string>();
  let chunk: SourceFile[] = [],
    chunkBytes = 0;
  async function extract(files: SourceFile[]): Promise<BuildResponse[]> {
    signal?.throwIfAborted();
    try {
      const response = await executeGraph(
        {
          scope,
          op: "build",
          files,
          root: domain.root,
          built_at_commit: revision,
          limits: {
            max_files: filesPerChunk,
            max_source_bytes: sourceBytesPerChunk,
            max_file_bytes: maxFileBytes,
            max_ast_depth: maxAstDepth,
            max_nodes: maxNodes,
            max_edges: maxEdges,
            max_output_bytes: Math.min(maxSnapshotBytes, 512 * 1024 * 1024),
          },
        },
        signal ? { signal } : {},
      );
      return [response.result];
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/graph limit exceeded: (?:AST depth|source syntax complexity)/.test(error.message)
      )
        throw error;
      const fileCount = files.length;
      if (fileCount > 1) {
        const middle = Math.floor(fileCount / 2);
        return [...(await extract(files.slice(0, middle))), ...(await extract(files.slice(middle)))];
      }
      const node = nodes.get(`file:${files[0]!.path}`)!;
      node.provenance = "UNRESOLVED";
      node.unresolvedReason = "native-depth-limit";
      node.parseError = error.message;
      coverage.parseErrors++;
      return [];
    }
  }
  async function flush() {
    if (!chunk.length) return;
    for (const result of await extract(chunk)) {
      coverage.chunks++;
      coverage.calls += result.graph.links.filter(edge => edge.relation === "calls").length;
      coverage.unresolvedCalls += result.stats.unresolved;
      coverage.parseErrors += result.parse_errors.length;
      const ids = new Map<string, string>();
      for (const node of result.graph.nodes) {
        const file = node.source_file;
        const fileId = file && node.id === normalized(file) ? `file:${file}` : null;
        const id = fileId ?? `symbol:${node.id}`;
        ids.set(node.id, id);
        if (!fileId) {
          const record = { ...node, id, provenance: file ? "EXTRACTED" : "UNRESOLVED" };
          const existing = nodes.get(id);
          if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
            coverage.symbolIdCollisions++;
            existing.provenance = "UNRESOLVED";
            existing.unresolvedReason = "native-symbol-id-collision";
            const conflicts = Array.isArray(existing.conflicts) ? (existing.conflicts as unknown[]) : [];
            const conflict = {
              source_file: node.source_file ?? null,
              source_location: node.source_location ?? null,
              file_type: node.file_type,
              label: node.label ?? null,
            };
            if (conflicts.length < 8 && !conflicts.some(value => JSON.stringify(value) === JSON.stringify(conflict)))
              conflicts.push(conflict);
            existing.conflicts = conflicts;
          } else if (!existing) {
            nodes.set(id, record);
          }
        }
      }
      for (const error of result.parse_errors) {
        const node = nodes.get(`file:${error.path}`);
        if (node) {
          node.provenance = "UNRESOLVED";
          node.unresolvedReason = "native-parse-error";
          node.parseError = error.error;
        }
      }
      for (const edge of result.graph.links) {
        const source = ids.get(edge.source),
          target = ids.get(edge.target);
        if (!source || !target) throw new Error("Native extractor returned an absent endpoint");
        const key = JSON.stringify([
          source,
          target,
          edge.relation,
          edge.source_file,
          edge.source_location,
          edge.confidence,
        ]);
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ ...edge, source, target });
        }
      }
      if (nodes.size > maxNodes || edges.length > maxEdges)
        throw new RangeError("Domain graph exceeds node or edge limits");
    }
    chunk = [];
    chunkBytes = 0;
    await scheduler.yield();
  }
  for (const file of domain.files) {
    signal?.throwIfAborted();
    if (!file.native) continue;
    if (chunk.length >= filesPerChunk || chunkBytes + file.bytes > sourceBytesPerChunk) await flush();
    let bytes: Uint8Array;
    if (file.git) bytes = (await gitBytes(file, options)).bytes;
    else {
      const stat = await lstat(file.absolute);
      if (stat.isSymbolicLink() || stat.size !== file.bytes || !contained(sourceRoot, await realpath(file.absolute)))
        throw new Error("Source path changed before extraction: " + file.path);
      bytes = await Bun.file(file.absolute)
        .slice(0, file.bytes + 1)
        .bytes();
    }
    if (bytes.length !== file.bytes || new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== file.sha256)
      throw new Error(`Source changed before extraction: ${file.path}`);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      const node = nodes.get(`file:${file.path}`)!;
      node.provenance = "UNRESOLVED";
      node.unresolvedReason = "invalid-utf8";
      coverage.parseErrors++;
      continue;
    }
    chunk.push({ path: file.path, content });
    chunkBytes += bytes.length;
  }
  await flush();
  for (const file of domain.files) {
    const node = nodes.get(`file:${file.path}`)!;
    if (node.provenance === "EXTRACTED") coverage.nativeFiles++;
    else coverage.unresolvedFiles++;
    if (file.sha256 === null) coverage.metadataOnlyFiles++;
  }
  const metadata = {
    scope,
    domain: domain.name,
    coverage,
    inputSHA256,
    producerSHA256,
    producerHashKind: "runtime-executable",
    revisionSource: options.input ? "pinned-git-object" : options.revision ? "explicit-verified-when-git" : "git-head",
    dirty,
    dirtyScope: options.input ? "pinned-git-snapshot" : options.surfaces ? "selected-surfaces" : "src-and-packages",
    dirtySurfaces: options.input ? (options.surfaces ?? ["all-git-paths"]) : (options.surfaces ?? ["src", "packages"]),
    sourceBytes: coverage.sourceBytes,
    hashedSourceBytes: coverage.hashedSourceBytes,
    sourceIdentity: "immutable-file-sha256",
    sourceConsistency: options.input ? "pinned-git-object" : "per-file-observation",
    ...(options.input ? { inputKind: "git", inputRepository: options.input.repository } : {}),
  };
  const artifact = await writeGraph(
    join(artifactDirectory, new Bun.CryptoHasher("sha256").update(scope.source).digest("hex")),
    nodes,
    edges,
    metadata,
    revision,
    maxSnapshotBytes,
    signal,
  );
  const counts = await registry.importGraph(
    repository,
    {
      producer: "bun native graph index",
      directed: true,
      multigraph: true,
      graph: metadata,
      built_at_commit: revision,
      nodes: [...nodes.values()],
      links: edges,
    },
    artifact.sha256,
    signal ? { signal } : {},
  );
  await registry.artifact(artifact.path, "bun-native-source-graph", undefined, {
    repository,
    source: scope.source,
    inputSHA256,
    producerSHA256,
  });
  registry.repository(`${namespace}/${domain.name}`, "source", domain.root, revision, { coverage });
  registry.event("bun-native-source-index", {
    repository,
    domain: domain.name,
    source: scope.source,
    revision,
    inputSHA256,
    sha256: artifact.sha256,
    coverage,
  });
  return {
    domain: domain.name,
    surface: domain.surface,
    repository,
    source: scope.source,
    snapshot: `${repository}:graph:${artifact.sha256}`,
    sha256: artifact.sha256,
    inputSHA256,
    cached: false,
    nodes: counts.nodes,
    edges: counts.edges,
    coverage,
    artifact: artifact.path,
  };
}

async function indexCodebase(registry: Registry, root: string, options: IndexOptions): Promise<IndexResult> {
  if (!options || options.profile !== "bun") throw new TypeError("Source indexing requires explicit profile 'bun'");
  if (typeof root !== "string" || !isAbsolute(root)) throw new TypeError("Source index root must be absolute");
  const namespace = options.namespace ?? "bun";
  if (typeof namespace !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(namespace))
    throw new TypeError("namespace must be a short identifier (letters, numbers, dot, underscore, hyphen)");
  options.signal?.throwIfAborted();
  const sourceRoot = await realpath(root);
  const surfaces = options.surfaces ?? (options.input ? ["root"] : ["src", "packages"]);
  if (!Array.isArray(surfaces) || surfaces.length === 0 || surfaces.length > 1024)
    throw new TypeError("surfaces must contain between 1 and 1024 relative directory paths");
  for (const surface of surfaces) validateRelativePath(surface, "surface");
  const concurrency = bound(options.concurrency, 2, 4, "concurrency");
  const maxFiles = bound(options.maxFiles, 100_000, 1_000_000, "maxFiles");
  const maxReadBytes = bound(options.maxReadBytes, 16 * 1024 * 1024, 16 * 1024 * 1024, "maxReadBytes");
  if (
    options.domains &&
    (options.domains.length > 1024 ||
      options.domains.some(domain => {
        try {
          validateRelativePath(domain, "domain");
          return false;
        } catch {
          return true;
        }
      }))
  )
    throw new TypeError("Invalid source domain selection");
  const [actualRevision, dirty] = options.input
    ? ([options.input.revision, null] as const)
    : await Promise.all([revisionAt(sourceRoot, options.signal), dirtyAt(sourceRoot, surfaces, options.signal)]);
  if (options.revision && actualRevision && options.revision !== actualRevision)
    throw new Error("Explicit source revision differs from Git HEAD");
  const revision = options.revision ?? actualRevision;
  if (!revision || typeof revision !== "string" || revision.length > 128)
    throw new Error("Source requires Git HEAD or an explicit fixture revision");
  const excluded = (options.excludePaths ?? []).map(path => validateRelativePath(path, "excludePath"));
  const artifactDirectory = resolve(
    options.artifactDirectory ??
      (registry.path === ":memory:"
        ? join(sourceRoot, ".graph-artifacts")
        : join(dirname(registry.path), "tmp", "bun-python", "graphs", namespace)),
  );
  const physicalArtifactDirectory = await canonicalDestination(artifactDirectory, options.signal);
  const physicalSurfaces = await Promise.all(
    surfaces.map(surface => canonicalDestination(resolve(sourceRoot, ...surface.split("/")), options.signal)),
  );
  for (const directory of options.input ? [] : [artifactDirectory, physicalArtifactDirectory]) {
    const artifactRelativePath = canonical(relative(sourceRoot, directory));
    const artifactExcluded = excluded.some(
      path => artifactRelativePath === path || artifactRelativePath.startsWith(`${path}/`),
    );
    if (
      !artifactExcluded &&
      (surfaces.some(surface => contained(resolve(sourceRoot, ...surface.split("/")), directory)) ||
        physicalSurfaces.some(surface => contained(surface, directory)))
    )
      throw new Error("Graph artifacts cannot be written inside indexed source surfaces");
  }
  producer ??= hashFile(graphBinary());
  const git = options.input ? await gitDomains(sourceRoot, options, maxFiles, maxReadBytes) : null;
  const [domains, producerSHA256] = await Promise.all([
    git ? Promise.resolve(git.domains) : scan(sourceRoot, options, maxFiles, maxReadBytes),
    producer,
  ]);
  const results = await parallel(domains, concurrency, options.signal, domain =>
    indexDomain(registry, domain, revision, options, producerSHA256, artifactDirectory, dirty, sourceRoot),
  );
  const finishedRevision = options.input
    ? options.input.revision
    : actualRevision
      ? await revisionAt(sourceRoot, options.signal)
      : revision;
  if (finishedRevision !== revision)
    throw new Error("Git HEAD changed during source indexing; inspect exact published domain snapshots");
  return {
    root: sourceRoot,
    profile: "bun",
    namespace,
    surfaces: git ? [...new Set(git.domains.map(d => d.surface))] : surfaces,
    revision,
    dirty,
    producerSHA256,
    domains: results,
    ...(git
      ? {
          input: {
            kind: "git" as const,
            repository: options.input!.repository,
            revision,
            files: git.total,
            selectedFiles: git.selected,
            fileCoverageComplete: git.total === git.selected,
          },
        }
      : {}),
  };
}

export { indexCodebase };
export default { indexCodebase };
