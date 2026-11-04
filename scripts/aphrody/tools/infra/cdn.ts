// SPDX-License-Identifier: Apache-2.0
// The shared asset CDN (tools/aphrody/config/asset-catalog.json).
//
//   bun scripts/aphrody/tools/infra/cdn.ts check               every source present, one owner per content
//   bun scripts/aphrody/tools/infra/cdn.ts build [--out dir]   release tree: s/<scope>/<path>, h/<hash>.<ext>, manifest
//   bun scripts/aphrody/tools/infra/cdn.ts publish --vps <ssh-host|local> [--dry-run]
//                                                  copy the release (rsync, or tar over ssh), then switch
//                                                  `current` atomically; `local` when run on the CDN host
//   add --json for machine-readable output
//
// Sources are catalogued paths of this checkout, tracked files only (`git ls-files`), so local
// scratch never reaches the CDN.

import { $ } from "bun";
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

export interface Source {
  scope: string;
  /** Directory under the checkout root, `/`-separated. */
  path: string;
  /** Optional path prefix under the published scope. */
  mount?: string;
  owns?: string;
  exclude: string[];
}

export interface Catalog {
  schemaVersion: number;
  cdn: {
    service: string;
    host: string;
    releaseRoot: string;
    paths: { scoped: string; hashed: string; manifest: string };
    hashLength: number;
  };
  sources: Source[];
}

export interface Entry {
  scope: string;
  /** Catalog source (its checkout path) that owns the file content. */
  source: string;
  /** Path under the source directory, `/`-separated. */
  path: string;
  /** Absolute file on disk. */
  file: string;
  sha256: string;
  size: number;
  type: string;
}

export interface Problem {
  kind: "missing-source" | "cross-source-duplicate" | "invalid-scope" | "duplicate-path";
  message: string;
}

const ROOT = resolve(import.meta.dir, "../../../../");

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".glb": "model/gltf-binary",
  ".lnk": "application/octet-stream",
};

export function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function loadCatalog(root = ROOT): Promise<Catalog> {
  return Bun.file(join(root, "tools/aphrody/config/asset-catalog.json")).json();
}

function excluded(path: string, patterns: string[]): boolean {
  return patterns.some(pattern => new Bun.Glob(pattern).match(path));
}

/** Tracked files of one source, hashed. `root` is the checkout holding every source. */
export async function scanSource(source: Source, root: string): Promise<Entry[] | null> {
  const dir = join(root, source.path);
  if ((await $`git -C ${root} rev-parse --git-dir`.quiet().nothrow()).exitCode !== 0) return null;
  const listed = await $`git -C ${root} ls-files -z -- ${source.path}`.quiet().nothrow();
  if (listed.exitCode !== 0 || !listed.stdout.toString()) return null;
  const prefix = `${source.path.replace(/\/$/, "")}/`;
  const paths = listed.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .map(p => p.slice(prefix.length));
  const entries = await Promise.all(
    paths
      .filter(path => !excluded(path, source.exclude))
      .map(async path => {
        const file = join(dir, path);
        const handle = Bun.file(file);
        if (!(await handle.exists())) return null; // deleted in the working tree
        const bytes = new Uint8Array(await handle.arrayBuffer());
        return {
          scope: source.scope,
          source: source.path,
          path: source.mount ? `${source.mount}/${path}` : path,
          file,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.byteLength,
          type: contentType(path),
        } satisfies Entry;
      }),
  );
  return entries.filter((entry): entry is Entry => entry !== null).toSorted((a, b) => a.path.localeCompare(b.path));
}

/** Every source scanned, plus the contract violations. */
export async function scan(catalog: Catalog, root = ROOT) {
  const problems: Problem[] = [];
  const entries: Entry[] = [];
  for (const source of catalog.sources) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(source.scope) || (source.mount && !/^[a-z0-9][a-z0-9/_-]*$/.test(source.mount))) {
      problems.push({
        kind: "invalid-scope",
        message: `scope ${JSON.stringify(source.scope)} or mount ${JSON.stringify(source.mount)} is invalid`,
      });
    }
    const found = await scanSource(source, root);
    if (found === null) {
      problems.push({
        kind: "missing-source",
        message: `${source.path}: no tracked file under ${root}`,
      });
      continue;
    }
    entries.push(...found);
  }
  const owners = new Map<string, Entry>();
  const publishedPaths = new Set<string>();
  for (const entry of entries) {
    const publishedPath = `${entry.scope}/${entry.path}`;
    if (publishedPaths.has(publishedPath)) {
      problems.push({
        kind: "duplicate-path",
        message: `${publishedPath} is published by more than one source`,
      });
    }
    publishedPaths.add(publishedPath);
    const owner = owners.get(entry.sha256);
    if (owner && owner.source !== entry.source) {
      problems.push({
        kind: "cross-source-duplicate",
        message: `${entry.source}:${entry.path} duplicates ${owner.source}:${owner.path} (${entry.sha256.slice(0, 12)}); keep one owner`,
      });
    } else if (!owner) {
      owners.set(entry.sha256, entry);
    }
  }
  return { entries, problems };
}

export interface Manifest {
  schemaVersion: 1;
  host: string;
  generatedAt: string;
  files: Record<string, { sha256: string; size: number; type: string; hashed: string }>;
}

export function hashedName(entry: Entry, length: number): string {
  return `${entry.sha256.slice(0, length)}${extname(entry.path).toLowerCase()}`;
}

export function buildManifest(catalog: Catalog, entries: Entry[], now = new Date()): Manifest {
  const files: Manifest["files"] = {};
  for (const entry of entries) {
    files[`${entry.scope}/${entry.path}`] = {
      sha256: entry.sha256,
      size: entry.size,
      type: entry.type,
      hashed: `${catalog.cdn.paths.hashed}${hashedName(entry, catalog.cdn.hashLength)}`,
    };
  }
  return {
    schemaVersion: 1,
    host: catalog.cdn.host,
    generatedAt: now.toISOString(),
    files,
  };
}

async function place(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  // Hard links keep the release cheap; fall back to a copy across volumes.
  await link(from, to).catch(() => copyFile(from, to));
}

/** Write the release tree and return its manifest. */
export async function build(catalog: Catalog, entries: Entry[], out: string): Promise<Manifest> {
  await rm(out, { recursive: true, force: true });
  const manifest = buildManifest(catalog, entries);
  const hashed = new Set<string>();
  for (const entry of entries) {
    await place(entry.file, join(out, "s", entry.scope, entry.path));
    const name = hashedName(entry, catalog.cdn.hashLength);
    if (!hashed.has(name)) {
      hashed.add(name);
      await place(entry.file, join(out, "h", name));
    }
  }
  await Bun.write(join(out, "s", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const sha = createHash("sha256").update(JSON.stringify(manifest.files)).digest("hex").slice(0, 12);
  await Bun.write(join(out, "RELEASE_SHA"), `${sha}\n`);
  return manifest;
}

function arg(name: string): string | undefined {
  const i = Bun.argv.indexOf(name);
  if (i >= 0) return Bun.argv[i + 1];
  return Bun.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

function safe(value: string): string {
  if (!/^[A-Za-z0-9_./:=+@-]+$/.test(value)) throw new Error(`refused value: ${value}`);
  return value;
}

async function publish(catalog: Catalog, out: string, vps: string, dryRun: boolean) {
  const release = (await Bun.file(join(out, "RELEASE_SHA")).text()).trim();
  const root = safe(catalog.cdn.releaseRoot);
  const target = `${root}/releases/${safe(release)}`;
  const local = vps === "local";
  const sshBin = process.platform === "win32" ? (Bun.which("ssh.exe") ?? "ssh") : "ssh";
  const ssh = local ? ["sh", "-c"] : [sshBin, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", safe(vps)];
  // On Windows rsync reads `C:/...` as a remote host `C`: a tar stream over ssh instead, with the
  // modes reset on the host.
  const copy: string[][] =
    process.platform !== "win32" && Bun.which("rsync")
      ? [
          // `--chmod`: a tree built on a Windows/DrvFs checkout reaches the host 0777 otherwise.
          // `-H`: `s/` and `h/` are hardlinks of the same bytes; without it the release doubles.
          [
            "rsync",
            "-aH",
            "--chmod=D755,F644",
            "--delete",
            `${out.replaceAll("\\", "/")}/`,
            local ? `${target}/` : `${vps}:${target}/`,
          ],
        ]
      : [
          ["tar", "-C", out, "-cf", "-", "."],
          [
            ...ssh,
            `rm -rf ${target} && mkdir -p ${target} && tar -xf - -C ${target} && chmod -R u=rwX,go=rX ${target}`,
          ],
        ];
  const steps = [
    [[...ssh, `mkdir -p ${target}`]],
    copy,
    [[...ssh, `ln -sfn ${target} ${root}/.current.new && mv -T ${root}/.current.new ${root}/current`]],
  ];
  for (const step of steps) {
    const line = step.map(cmd => cmd.join(" ")).join(" | ");
    if (dryRun) {
      console.log(`dry-run: ${line}`);
      continue;
    }
    const procs: Bun.Subprocess[] = [];
    for (const cmd of step) {
      const previous = procs.at(-1);
      procs.push(
        Bun.spawn(cmd, {
          windowsHide: true,
          stdin: previous ? (previous.stdout as ReadableStream) : "inherit",
          stdout: cmd === step.at(-1) ? "inherit" : "pipe",
          stderr: "inherit",
        }),
      );
    }
    const codes = await Promise.all(procs.map(p => p.exited));
    if (codes.some(code => code !== 0)) throw new Error(`failed: ${line}`);
  }
  return { release, target };
}

if (import.meta.main) {
  const command = Bun.argv[2] ?? "check";
  const json = Bun.argv.includes("--json");
  const catalog = await loadCatalog();
  const { entries, problems } = await scan(catalog);
  const bytes = entries.reduce((n, e) => n + e.size, 0);
  const unique = new Set(entries.map(e => e.sha256)).size;
  const summary = { files: entries.length, unique, bytes, problems };

  if (command === "check") {
    if (json) console.log(JSON.stringify(summary, null, 2));
    else {
      for (const p of problems) console.log(`[${p.kind}] ${p.message}`);
      console.log(
        `${entries.length} files, ${unique} unique contents, ${(bytes / 1e6).toFixed(1)} MB, ${problems.length} problem(s)`,
      );
    }
    process.exit(problems.length === 0 ? 0 : 1);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`[${p.kind}] ${p.message}`);
    process.exit(1);
  }
  const out = resolve(arg("--out") ?? join(ROOT, "build/cdn/release"));
  if (command === "build" || command === "publish") {
    const manifest = await build(catalog, entries, out);
    const result: Record<string, unknown> = {
      ...summary,
      out,
      manifestFiles: Object.keys(manifest.files).length,
    };
    if (command === "publish") {
      const vps = arg("--vps") ?? Bun.env.APHRODY_VPS_SSH;
      if (!vps) throw new Error("publish needs --vps <ssh-host> or APHRODY_VPS_SSH");
      Object.assign(result, await publish(catalog, out, vps, Bun.argv.includes("--dry-run")));
    }
    console.log(json ? JSON.stringify(result, null, 2) : `${command}: ${entries.length} files -> ${out}`);
    process.exit(0);
  }
  console.error(`unknown command ${command}: check | build | publish`);
  process.exit(2);
}
