// SPDX-License-Identifier: Apache-2.0
// Windows 11 native template scanner: metadata of this PC's Windows install for win32.aphrody.com.
//
//   sudo bun factory/win11-template/scan.ts mft       elevated: MFT enumeration and USN checkpoint
//   sudo bun factory/win11-template/scan.ts journal   elevated: USN journal since the checkpoint -> dirty dirs
//   bun factory/win11-template/scan.ts build [--incremental] [--wine <dir>] [--workers N]
//
// `mft` and `journal` only read the volume. They keep, in build/win11-template (ignored, never published), the
// directory record map of the scanned system trees, the per-record attributes and the journal checkpoint. Paths
// of the owner's own files are resolved in memory and dropped; only counts leave the enumeration.
//
// `build` walks the system trees with readdir (the MFT enumeration returns one name per record, so the System32
// hard links into WinSxS only show up in a directory listing), applies rules.ts, reads PE facts in workers and
// writes the published template (apps/webos/public/win11) and the Wine coverage report. File contents are
// parsed and hashed, never copied.
import windows from "bun:windows";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import {
  FLAG_MOUNT,
  FLAG_SKELETON,
  MANIFEST_FORMAT,
  NONE,
  PE_CATALOG,
  PE_DOTNET,
  PE_EMBEDDED_SIGNATURE,
  PE_KINDS,
  PE_MACHINES,
  PE_SUBSYSTEMS,
  StringBuilder,
  VERSION_KEYS,
  encodeChunk,
  type ChunkRef,
  type Column,
  type Manifest,
} from "../../apps/webos/src/win11/format";
import type { Job, PeFacts, Result } from "./pe-worker";
import { CONFIG_EXTENSIONS, PE_EXTENSIONS, SCANNED_ROOTS, SKELETON, classify, extOf, safePath } from "./rules";
import { buildCoverage, wineChunkColumns, writeCoverage } from "./wine";

const ROOT = resolve(import.meta.dir, "../..");
const PRIVATE = join(ROOT, "build/win11-template");
const PUBLIC = join(ROOT, "apps/webos/public/win11");
const DRIVE = "C";
const VOLUME = `${DRIVE}:\\`;

/** Tree chunks: the longest matching prefix owns a node. */
export const CHUNK_PREFIXES = [
  "",
  "Windows",
  "Windows/System32",
  "Windows/System32/DriverStore",
  "Windows/SysWOW64",
  "Windows/WinSxS",
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
  "Users",
];

const args = process.argv.slice(2);
const command = args[0] ?? "build";
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const log = (...a: unknown[]) => console.error(`[win11 ${new Date().toISOString().slice(11, 19)}]`, ...a);
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

function tracked(rel: string): boolean {
  return SCANNED_ROOTS.some(r => rel === r || rel.startsWith(`${r}/`));
}

// ---- elevated: MFT and journal ------------------------------------------------------------------

interface MftState {
  generated: string;
  journal: { journalId: string; nextUsn: string };
  stats: Record<string, number>;
  /** record number -> relative path, directories of the scanned trees only. */
  dirs: Record<string, string>;
  /** record number -> FILE_ATTRIBUTE_* for every record under the scanned trees. */
  attributes: Record<string, number>;
}

function requireElevated() {
  if (!windows.isElevated()) {
    console.error("This step opens \\\\.\\C: and needs an elevated process: run it with `sudo bun ...`.");
    process.exit(2);
  }
}

function mft() {
  requireElevated();
  using volume = new windows.ntfs.Volume(DRIVE);
  const journal = volume.queryOrCreateJournal();
  const t0 = performance.now();
  const parentOf = new Map<number, number>();
  const nameOf = new Map<number, string>();
  const dirAttr = new Map<number, number>();
  const files: [number, number, number][] = [];
  let records = 0;
  let rawBytes = 0;
  let next = 0n;
  for (;;) {
    const page = volume.enumerateMftPage(next, 16 << 20);
    for (const r of page.records) {
      records++;
      // What FSCTL_ENUM_USN_DATA delivers per record, for the size measurement; the names stay in memory.
      rawBytes += 8 + 8 + 4 + 2 + r.name.length * 2;
      if (r.attributes & windows.ntfs.FILE_ATTRIBUTE_DIRECTORY) {
        parentOf.set(r.record, r.parent);
        nameOf.set(r.record, r.name);
        dirAttr.set(r.record, r.attributes);
      } else files.push([r.record, r.parent, r.attributes]);
    }
    next = page.next;
    if (page.complete) break;
  }
  const enumMs = performance.now() - t0;
  const pathCache = new Map<number, string | null>([[windows.ntfs.ROOT_RECORD, ""]]);
  const pathOf = (record: number): string | null => {
    const chain: number[] = [];
    let cur = record;
    let found: string | null | undefined;
    for (let depth = 0; depth < 256; depth++) {
      found = pathCache.get(cur);
      if (found !== undefined) break;
      const name = nameOf.get(cur);
      const parent = parentOf.get(cur);
      if (name === undefined || parent === undefined) {
        found = null;
        break;
      }
      chain.push(cur);
      cur = parent;
    }
    let base = found ?? null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const r = chain[i]!;
      base = base === null ? null : base === "" ? nameOf.get(r)! : `${base}/${nameOf.get(r)}`;
      pathCache.set(r, base);
    }
    return base;
  };
  const dirs: Record<string, string> = {};
  const attributes: Record<string, number> = {};
  const perRoot: Record<string, number> = {};
  let trackedDirs = 0;
  for (const record of parentOf.keys()) {
    const p = pathOf(record);
    if (p !== null && tracked(p)) {
      dirs[record] = p;
      trackedDirs++;
    }
  }
  let trackedFiles = 0;
  for (const [record, parent, attr] of files) {
    const p = pathOf(parent);
    if (p === null) continue;
    const top = p.split("/")[0] || "(root)";
    if (tracked(p)) {
      attributes[record] = attr;
      trackedFiles++;
      perRoot[top] = (perRoot[top] ?? 0) + 1;
    }
  }
  for (const record of Object.keys(dirs)) attributes[record] = dirAttr.get(Number(record)) ?? 0x10;
  const state: MftState = {
    generated: new Date().toISOString(),
    journal: { journalId: journal.journalId.toString(), nextUsn: journal.nextUsn.toString() },
    stats: {
      mftRecords: records,
      mftDirectories: parentOf.size,
      mftEnumeratedBytes: rawBytes,
      mftEnumerationMs: Math.round(enumMs),
      trackedDirectories: trackedDirs,
      trackedFileRecords: trackedFiles,
      ...Object.fromEntries(Object.entries(perRoot).map(([k, v]) => [`mftFileRecords:${k}`, v])),
    },
    dirs,
    attributes,
  };
  mkdirSync(PRIVATE, { recursive: true });
  Bun.write(join(PRIVATE, "mft.json"), json(state));
  log(
    `MFT: ${records} records (${(rawBytes / 1048576).toFixed(1)} MiB enumerated) in ${(enumMs / 1000).toFixed(1)} s; ${trackedDirs} system dirs, ${trackedFiles} system file records`,
  );
}

function journal() {
  requireElevated();
  const statePath = join(PRIVATE, "mft.json");
  if (!existsSync(statePath)) throw new Error("no checkpoint: run `scan.ts mft` first");
  const state = JSON.parse(require("node:fs").readFileSync(statePath, "utf8")) as MftState;
  using volume = new windows.ntfs.Volume(DRIVE);
  const current = volume.queryJournal();
  const dirty = new Set<string>();
  let restart = current.journalId.toString() !== state.journal.journalId;
  let usn = BigInt(state.journal.nextUsn);
  let changes = 0;
  while (!restart && usn < current.nextUsn) {
    let page;
    try {
      page = volume.readJournal(usn, current.journalId, 1 << 20);
    } catch (e) {
      if ((e as { winError?: number }).winError === 1181) {
        restart = true;
        break;
      }
      throw e;
    }
    if (page.records.length === 0 || page.next <= usn) break;
    for (const r of page.records) {
      const parent = state.dirs[r.parentRecord];
      if (parent === undefined) continue;
      changes++;
      dirty.add(parent);
      // A changed directory is rescanned as a whole; new ones are found through their parent.
      if (r.attributes & 0x10) {
        const self = state.dirs[r.record];
        if (self !== undefined) dirty.add(self);
      }
    }
    usn = page.next;
  }
  state.journal = { journalId: current.journalId.toString(), nextUsn: (restart ? current.nextUsn : usn).toString() };
  Bun.write(statePath, json(state));
  Bun.write(
    join(PRIVATE, "dirty.json"),
    json({ generated: new Date().toISOString(), restart, changes, dirs: [...dirty].sort() }),
  );
  log(
    restart
      ? "journal reset or truncated: run a full `mft` and `build`"
      : `journal: ${changes} changes in ${dirty.size} system dirs`,
  );
}

// ---- build: walk, facts, chunks ------------------------------------------------------------------

interface Node {
  rel: string;
  dir: boolean;
  attr: number;
  size: number;
  mtime: number;
  flags: number;
  pe?: PeFacts;
}

interface FactsCache {
  [rel: string]: {
    size: number;
    mtime: number;
    facts: PeFacts | null;
    catalog?: { catalog: string | null; signer: string | null };
    notPe?: boolean;
  };
}

const MICROSOFT_SIGNER = /^Microsoft\b/i;
const THIRD_PARTY_SIGNER = /Hardware Compatibility|Third Party/i;

function microsoftOwned(signer: string | null, company: string | undefined): boolean {
  if (!signer || !MICROSOFT_SIGNER.test(signer) || THIRD_PARTY_SIGNER.test(signer)) return false;
  return company === undefined || company === "" || /microsoft/i.test(company);
}

/** Non-PE files that need a catalog listing to be published (where third-party software drops files). */
function needsCatalog(rel: string): boolean {
  const l = rel.toLowerCase();
  return (
    /^windows\/fonts\/[^/]+$/.test(l) ||
    /^windows\/(system32|syswow64)\/[^/]+$/.test(l) ||
    /^windows\/system32\/drivers\/[^/]+$/.test(l)
  );
}

async function runWorkers(jobs: Job[], workers: number): Promise<Map<number, Result>> {
  const results = new Map<number, Result>();
  if (jobs.length === 0) return results;
  const batch = 16;
  let next = 0;
  let done = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(workers, Math.ceil(jobs.length / batch)) }, async () => {
      const w = new Worker(new URL("./pe-worker.ts", import.meta.url).href);
      try {
        for (;;) {
          const slice = jobs.slice(next, next + batch);
          next += batch;
          if (slice.length === 0) break;
          const out = await new Promise<Result[]>((res, rej) => {
            w.onmessage = e => res(e.data as Result[]);
            w.onerror = e => rej(e);
            w.postMessage(slice);
          });
          for (const r of out) results.set(r.id, r);
          done += out.length;
          if (done % 2048 < batch)
            log(`facts ${done}/${jobs.length} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
        }
      } finally {
        w.terminate();
      }
    }),
  );
  return results;
}

interface WalkStats {
  denied: string[];
  skipped: number;
  reparse: number;
}

function walk(
  nodes: Map<string, Node>,
  rootRel: string,
  inboxInfs: Set<string>,
  attributes: Record<string, number>,
  stats: WalkStats,
  recursive = true,
) {
  const stack = [rootRel];
  while (stack.length) {
    const rel = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(VOLUME + rel.replaceAll("/", "\\"), { withFileTypes: true });
    } catch (e) {
      stats.denied.push(`${rel} (${(e as NodeJS.ErrnoException).code ?? "error"})`);
      continue;
    }
    for (const ent of entries) {
      const child = `${rel}/${ent.name}`;
      const isDir = ent.isDirectory();
      if (ent.isSymbolicLink()) {
        stats.reparse++;
        continue;
      }
      if (classify(child, isDir, inboxInfs) === "skip") {
        stats.skipped++;
        continue;
      }
      let st;
      try {
        st = statSync(VOLUME + child.replaceAll("/", "\\"), { bigint: true });
      } catch (e) {
        stats.denied.push(`${child} (${(e as NodeJS.ErrnoException).code ?? "error"})`);
        continue;
      }
      const record = Number(st.ino & 0xffff_ffff_ffffn);
      const attr = attributes[record] ?? (isDir ? 0x10 : 0x20);
      nodes.set(child, {
        rel: child,
        dir: isDir,
        attr: isDir ? attr | 0x10 : attr & ~0x10,
        size: isDir ? 0 : Number(st.size),
        mtime: Math.floor(Number(st.mtimeMs) / 1000),
        flags: 0,
      });
      if (isDir && recursive) stack.push(child);
    }
  }
}

function osFacts(): Record<string, string | number | null> {
  const key = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
  const get = (name: string) => {
    try {
      const v = windows.registry.get(key, name);
      return v === null ? null : typeof v.value === "bigint" ? Number(v.value) : (v.value as string | number);
    } catch {
      return null;
    }
  };
  const v = windows.version();
  return {
    productName: v.productName ?? get("ProductName"),
    editionId: get("EditionID"),
    displayVersion: get("DisplayVersion"),
    currentBuild: get("CurrentBuild"),
    ubr: get("UBR"),
    buildLabEx: get("BuildLabEx"),
    installationType: get("InstallationType"),
    version: `${v.major}.${v.minor}.${v.build}`,
    architecture: process.arch === "x64" ? "x64" : process.arch,
  };
}

async function build() {
  const incremental = flag("incremental");
  const workers = Number(option("workers") ?? Math.max(2, Math.min(12, cpus().length - 2)));
  const winePath = resolve(option("wine") ?? process.env.WINE_SRC ?? join(ROOT, "../wine"));
  mkdirSync(PRIVATE, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });
  const mftPath = join(PRIVATE, "mft.json");
  const mftState: MftState | null = existsSync(mftPath) ? await Bun.file(mftPath).json() : null;
  if (!mftState) log("no MFT checkpoint (run `sudo bun scan.ts mft`): directory walk only, attributes approximated");
  const attributes = mftState?.attributes ?? {};

  const inboxInfs = new Set(
    readdirSync(`${VOLUME}Windows\\INF`)
      .map(n => n.toLowerCase())
      .filter(n => n.endsWith(".inf") && !/^oem\d+\.inf$/.test(n)),
  );
  const stats: WalkStats = { denied: [], skipped: 0, reparse: 0 };
  const nodesPath = join(PRIVATE, "nodes.json");
  let nodes = new Map<string, Node>();
  const t0 = performance.now();
  if (incremental && existsSync(nodesPath)) {
    nodes = new Map(((await Bun.file(nodesPath).json()) as Node[]).map(n => [n.rel, n]));
    const dirty = existsSync(join(PRIVATE, "dirty.json"))
      ? ((await Bun.file(join(PRIVATE, "dirty.json")).json()) as { dirs: string[]; restart: boolean })
      : { dirs: [], restart: true };
    if (dirty.restart) throw new Error("journal checkpoint lost: run a full build");
    for (const dir of dirty.dirs) {
      for (const key of nodes.keys()) if (key.startsWith(`${dir}/`)) nodes.delete(key);
      if (existsSync(VOLUME + dir.replaceAll("/", "\\"))) walk(nodes, dir, inboxInfs, attributes, stats);
    }
    log(`incremental: rescanned ${dirty.dirs.length} dirs`);
  } else {
    for (const root of SCANNED_ROOTS) {
      const st = statSync(VOLUME + root, { bigint: true });
      nodes.set(root, {
        rel: root,
        dir: true,
        attr: attributes[Number(st.ino & 0xffff_ffff_ffffn)] ?? 0x10,
        size: 0,
        mtime: Math.floor(Number(st.mtimeMs) / 1000),
        flags: 0,
      });
      walk(nodes, root, inboxInfs, attributes, stats);
    }
  }
  for (const [rel, attr] of SKELETON)
    if (!nodes.has(rel)) nodes.set(rel, { rel, dir: true, attr, size: 0, mtime: 0, flags: FLAG_SKELETON });
  // Program Files: keep only the allowlisted subtrees (classify lets their ancestors through).
  log(
    `walk: ${nodes.size} entries in ${((performance.now() - t0) / 1000).toFixed(1)} s, ${stats.skipped} skipped, ${stats.denied.length} unreadable`,
  );

  // PE facts, cached by path, size and mtime.
  const cachePath = join(PRIVATE, "facts.json.zst");
  const cache: FactsCache = existsSync(cachePath)
    ? JSON.parse(new TextDecoder().decode(Bun.zstdDecompressSync(await Bun.file(cachePath).bytes())))
    : {};
  const jobs: Job[] = [];
  const jobRel: string[] = [];
  for (const n of nodes.values()) {
    if (n.dir || n.flags & FLAG_SKELETON) continue;
    const ext = extOf(n.rel);
    const pe = PE_EXTENSIONS.has(ext);
    if (!pe && !needsCatalog(n.rel)) continue;
    const hit = cache[n.rel];
    if (hit && hit.size === n.size && hit.mtime === n.mtime) continue;
    jobs.push({
      id: jobRel.length,
      path: VOLUME + n.rel.replaceAll("/", "\\"),
      name: n.rel.slice(n.rel.lastIndexOf("/") + 1),
      catalog: true,
    });
    jobRel.push(n.rel);
  }
  log(`facts: ${jobs.length} files to read (${Object.keys(cache).length} cached), ${workers} workers`);
  const results = await runWorkers(jobs, workers);
  for (const [id, r] of results) {
    const rel = jobRel[id]!;
    const n = nodes.get(rel)!;
    cache[rel] = { size: n.size, mtime: n.mtime, facts: r.facts, catalog: r.catalogOnly, notPe: r.notPe };
  }
  for (const k of Object.keys(cache)) if (!nodes.has(k)) delete cache[k];
  await Bun.write(cachePath, Bun.zstdCompressSync(new TextEncoder().encode(JSON.stringify(cache)), { level: 3 }));

  // Publish only Microsoft-owned binaries; count the others.
  let thirdParty = 0;
  let peCount = 0;
  let configFiles = 0;
  for (const n of [...nodes.values()]) {
    if (n.dir) continue;
    const c = cache[n.rel];
    if (CONFIG_EXTENSIONS.has(extOf(n.rel)) && n.rel.startsWith("Windows/")) configFiles++;
    if (!c) continue;
    if (c.facts) {
      const signer = c.facts.embeddedSigner ?? c.facts.catalogSigner;
      if (!microsoftOwned(signer, c.facts.version.CompanyName)) {
        nodes.delete(n.rel);
        thirdParty++;
        continue;
      }
      n.pe = c.facts;
      peCount++;
    } else if (needsCatalog(n.rel) && !microsoftOwned(c.catalog?.signer ?? null, undefined)) {
      // Non-PE files in System32/SysWOW64/drivers/Fonts must be listed in a Microsoft catalog.
      nodes.delete(n.rel);
      thirdParty++;
    }
  }
  // Folders left empty by the filter keep their name: they are part of the real Windows layout.
  for (const n of nodes.values()) if (!safePath(n.rel, n.dir)) throw new Error(`refusing to publish ${n.rel}`);
  await Bun.write(nodesPath, JSON.stringify([...nodes.values()].map(({ pe, ...rest }) => rest)));
  log(
    `publish: ${nodes.size} entries, ${peCount} Microsoft PE files, ${thirdParty} third-party or unlisted files withheld`,
  );

  const coverage = buildCoverage(
    [...nodes.values()].filter(n => n.pe).map(n => ({ rel: n.rel, pe: n.pe! })),
    winePath,
  );
  const { manifest, rawIndexBytes, rawFactsBytes } = await writeTemplate(nodes, coverage, mftState, stats, {
    thirdParty,
    peCount,
    configFiles,
  });
  await writeCoverage(ROOT, coverage, manifest);
  log(
    `index: ${(rawFactsBytes / 1048576).toFixed(1)} MiB facts JSON -> ${(rawIndexBytes / 1048576).toFixed(1)} MiB columnar -> ${(manifest.packBytes / 1048576).toFixed(2)} MiB zstd`,
  );
}

// ---- chunk encoding ------------------------------------------------------------------------------

function chunkOf(rel: string): string {
  let best = "";
  for (const p of CHUNK_PREFIXES) if (p && (rel === p || rel.startsWith(`${p}/`)) && p.length > best.length) best = p;
  return best;
}

const index = <T extends readonly string[]>(list: T, v: string) => {
  const i = list.indexOf(v as T[number]);
  return i < 0 ? 0 : i;
};

async function writeTemplate(
  nodes: Map<string, Node>,
  coverage: ReturnType<typeof buildCoverage>,
  mftState: MftState | null,
  walkStats: WalkStats,
  counts: { thirdParty: number; peCount: number; configFiles: number },
) {
  const symbols = new StringBuilder();
  const buckets = new Map<string, Node[]>(CHUNK_PREFIXES.map(p => [p, []]));
  for (const n of nodes.values()) buckets.get(chunkOf(n.rel))!.push(n);
  const frames: { ref: Omit<ChunkRef, "offset" | "length">; bytes: Uint8Array }[] = [];
  let rawIndexBytes = 0;
  const encodeFrame = (ref: Omit<ChunkRef, "offset" | "length" | "rawLength" | "sha256">, raw: Uint8Array) => {
    rawIndexBytes += raw.length;
    const bytes = Bun.zstdCompressSync(raw, { level: 19 });
    const sha256 = new Bun.CryptoHasher("sha256").update(raw).digest("hex");
    frames.push({ ref: { ...ref, rawLength: raw.length, sha256 }, bytes });
  };

  for (const prefix of CHUNK_PREFIXES) {
    const id = prefix === "" ? "root" : prefix.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
    const self = prefix === "" ? undefined : nodes.get(prefix);
    if (prefix !== "" && !self) continue;
    const own = buckets.get(prefix)!.filter(n => n.rel !== prefix);
    // Each nested chunk's root also appears in its parent chunk, flagged FLAG_MOUNT.
    for (const q of CHUNK_PREFIXES) {
      if (!q || q === prefix) continue;
      const cut = q.lastIndexOf("/");
      const n = nodes.get(q);
      if (n && chunkOf(cut < 0 ? "" : q.slice(0, cut)) === prefix) own.push(n);
    }
    const list = [...own].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    const names = new StringBuilder();
    const n = list.length + 1;
    const parent = new Uint32Array(n);
    const name = new Uint32Array(n);
    const attr = new Uint32Array(n);
    const size = new Float64Array(n);
    const mtime = new Uint32Array(n);
    const pe = new Int32Array(n).fill(-1);
    const flags = new Uint8Array(n);
    const at = new Map<string, number>([[prefix, 0]]);
    parent[0] = NONE;
    name[0] = names.id(prefix.slice(prefix.lastIndexOf("/") + 1));
    attr[0] = self?.attr ?? 0x16;
    mtime[0] = self?.mtime ?? 0;
    flags[0] = self?.flags ?? 0;
    const peNodes: Node[] = [];
    list.forEach((node, i) => {
      const k = i + 1;
      at.set(node.rel, k);
      const cut = node.rel.lastIndexOf("/");
      const p = at.get(cut < 0 ? "" : node.rel.slice(0, cut));
      if (p === undefined) throw new Error(`orphan ${node.rel} in chunk ${id}`);
      parent[k] = p;
      name[k] = names.id(node.rel.slice(cut + 1));
      attr[k] = node.attr;
      size[k] = node.size;
      mtime[k] = node.mtime;
      flags[k] = node.flags | (node.rel !== prefix && CHUNK_PREFIXES.includes(node.rel) ? FLAG_MOUNT : 0);
      if (node.pe && !(flags[k]! & FLAG_MOUNT)) {
        pe[k] = peNodes.length;
        peNodes.push(node);
      }
    });
    encodeFrame(
      { id, kind: "tree", prefix, nodes: n },
      encodeChunk(
        { kind: "tree", id, prefix },
        { parent, name, attr, size, mtime, pe, flags, ...names.columns("names") },
      ),
    );
    if (peNodes.length)
      encodeFrame({ id: `${id}.pe`, kind: "pe", prefix, nodes: peNodes.length }, peChunk(`${id}.pe`, peNodes, symbols));
  }
  const wine = wineChunkColumns(coverage, symbols);
  encodeFrame({ id: "wine", kind: "wine" }, encodeChunk({ kind: "wine", id: "wine", meta: wine.meta }, wine.columns));
  encodeFrame(
    { id: "symbols", kind: "symbols", nodes: symbols.list.length },
    encodeChunk({ kind: "symbols", id: "symbols" }, symbols.columns("s")),
  );

  let offset = 0;
  const chunks: ChunkRef[] = frames.map(f => {
    const ref = { ...f.ref, offset, length: f.bytes.length } as ChunkRef;
    offset += f.bytes.length;
    return ref;
  });
  const pack = new Uint8Array(offset);
  frames.forEach((f, i) => pack.set(f.bytes, chunks[i]!.offset));
  const rawFacts = JSON.stringify([...nodes.values()]);
  const rawFactsBytes = Buffer.byteLength(rawFacts);
  const brotliFacts = brotliCompressSync(Buffer.from(rawFacts)).length;
  const manifest: Manifest = {
    format: MANIFEST_FORMAT,
    version: 1,
    generated: new Date().toISOString(),
    source: osFacts(),
    pack: "win11-template.pack",
    packBytes: pack.length,
    chunks,
    stats: {
      entries: nodes.size,
      directories: [...nodes.values()].filter(n => n.dir).length,
      files: [...nodes.values()].filter(n => !n.dir).length,
      peFiles: counts.peCount,
      configFiles: counts.configFiles,
      withheldThirdParty: counts.thirdParty,
      skippedByRules: walkStats.skipped,
      unreadable: walkStats.denied.length,
      reparsePoints: walkStats.reparse,
      symbols: symbols.list.length,
      rawFactsJsonBytes: rawFactsBytes,
      rawFactsBrotliBytes: brotliFacts,
      indexBytes: rawIndexBytes,
      packZstdBytes: pack.length,
      ...(mftState?.stats ?? {}),
    },
    wine: coverage.wine,
    privacy: [
      "Metadata only: paths, sizes, attributes, timestamps, PE header facts, signer names and SHA-256 hashes.",
      "No file contents of Windows, Program Files or third-party software are included.",
      "ProgramData and Users are a fixed skeleton of the standard layout, not this PC's folders.",
      "Binaries not signed by Microsoft are withheld; logs, caches, hives and key stores are skipped.",
    ],
  };
  await Bun.write(join(PUBLIC, "win11-template.pack"), pack);
  const manifestText = JSON.stringify(manifest, null, 1);
  await Bun.write(join(PUBLIC, "win11-template.json"), manifestText);
  await Bun.write(join(PUBLIC, "win11-template.json.br"), brotliCompressSync(Buffer.from(manifestText)));
  await Bun.write(join(PRIVATE, "unreadable.json"), JSON.stringify(walkStats.denied, null, 1));
  return { manifest, rawIndexBytes, rawFactsBytes };
}

function peChunk(id: string, list: Node[], symbols: StringBuilder): Uint8Array {
  const text = new StringBuilder();
  const n = list.length;
  const kind = new Uint8Array(n);
  const machine = new Uint8Array(n);
  const bits = new Uint8Array(n);
  const subsystem = new Uint8Array(n);
  const flags = new Uint8Array(n);
  const timestamp = new Uint32Array(n);
  const imageSize = new Uint32Array(n);
  const characteristics = new Uint16Array(n);
  const dllCharacteristics = new Uint16Array(n);
  const versions = VERSION_KEYS.map(() => new Uint32Array(n));
  const signer = new Uint32Array(n);
  const catalog = new Uint32Array(n);
  const exportName = new Uint32Array(n);
  const sha = new Uint8Array(n * 32);
  const expStart = new Uint32Array(n + 1);
  const impStart = new Uint32Array(n + 1);
  const resStart = new Uint32Array(n + 1);
  const expName: number[] = [];
  const expOrdinal: number[] = [];
  const expForward: number[] = [];
  const impModule: number[] = [];
  const impDelay: number[] = [];
  const impFnStart: number[] = [0];
  const impFn: number[] = [];
  const resType: number[] = [];
  const resName: number[] = [];
  const resLang: number[] = [];
  const resSize: number[] = [];
  const opt = (s: string | null | undefined) => (s ? text.id(s) : NONE);
  list.forEach((node, i) => {
    const f = node.pe!;
    kind[i] = index(PE_KINDS, f.kind);
    machine[i] = index(PE_MACHINES, f.machine);
    bits[i] = f.bits;
    subsystem[i] = index(PE_SUBSYSTEMS, f.subsystem);
    flags[i] =
      (f.dotnet ? PE_DOTNET : 0) | (f.embeddedSigner ? PE_EMBEDDED_SIGNATURE : 0) | (f.catalog ? PE_CATALOG : 0);
    timestamp[i] = f.timestamp >>> 0;
    imageSize[i] = f.imageSize >>> 0;
    characteristics[i] = f.characteristics;
    dllCharacteristics[i] = f.dllCharacteristics;
    VERSION_KEYS.forEach((k, j) => (versions[j]![i] = opt(f.version[k])));
    signer[i] = opt(f.embeddedSigner ?? f.catalogSigner);
    catalog[i] = opt(f.catalog);
    exportName[i] = opt(f.exportName);
    for (let b = 0; b < 32; b++) sha[i * 32 + b] = parseInt(f.sha256.slice(b * 2, b * 2 + 2), 16);
    expStart[i] = expName.length;
    for (const [name, ordinal, forwarder] of f.exports) {
      expName.push(name === null ? NONE : symbols.id(name));
      expOrdinal.push(ordinal);
      expForward.push(opt(forwarder));
    }
    impStart[i] = impModule.length;
    for (const [module, delay, fns] of f.imports) {
      impModule.push(symbols.id(module));
      impDelay.push(delay ? 1 : 0);
      for (const fn of fns) impFn.push(symbols.id(fn));
      impFnStart.push(impFn.length);
    }
    resStart[i] = resType.length;
    for (const [type, name, lang, size] of f.resources ?? []) {
      resType.push(text.id(type));
      resName.push(text.id(name));
      resLang.push(lang);
      resSize.push(size);
    }
  });
  expStart[n] = expName.length;
  impStart[n] = impModule.length;
  resStart[n] = resType.length;
  const columns: Record<string, Column> = {
    kind,
    machine,
    bits,
    subsystem,
    flags,
    timestamp,
    imageSize,
    characteristics,
    dllCharacteristics,
    ...Object.fromEntries(VERSION_KEYS.map((k, j) => [`v.${k}`, versions[j]!])),
    signer,
    catalog,
    exportName,
    sha256: sha,
    expStart,
    expName: Uint32Array.from(expName),
    expOrdinal: Uint32Array.from(expOrdinal),
    expForward: Uint32Array.from(expForward),
    impStart,
    impModule: Uint32Array.from(impModule),
    impDelay: Uint8Array.from(impDelay),
    impFnStart: Uint32Array.from(impFnStart),
    impFn: Uint32Array.from(impFn),
    resStart,
    resType: Uint32Array.from(resType),
    resName: Uint32Array.from(resName),
    resLang: Uint32Array.from(resLang),
    resSize: Uint32Array.from(resSize),
    ...text.columns("text"),
  };
  return encodeChunk({ kind: "pe", id }, columns);
}

if (import.meta.main) {
  if (process.platform !== "win32") throw new Error("the scanner reads a Windows volume");
  if (command === "mft") mft();
  else if (command === "journal") journal();
  else if (command === "build") await build();
  else {
    console.error("usage: scan.ts mft | journal | build [--incremental] [--wine <dir>] [--workers N]");
    process.exit(2);
  }
}
