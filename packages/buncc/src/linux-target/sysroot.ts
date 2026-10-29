/**
 * Linux sysroot assembly from Arch packages, usable from a Windows host (no tar/zstd/symlink privileges needed).
 * `sysrootManifest` is pure; `fetchIndex`, `downloadPackages` and `extractPackage` do the I/O.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, unlinkSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { ARCH_MIRROR, ArchIndex, archClosure, packageUrl, parseDb, type ArchPackage } from "./pacmandb.ts";
import { untar, type TarEntry } from "./tar.ts";
import type { LinuxArch } from "./crossfile.ts";

/** Repository databases older than this are downloaded again (rolling repos drop old package files). */
export const DB_MAX_AGE_MS = 6 * 3600 * 1000;

export const ARCH_REPOS = ["core", "extra"] as const;
/** Arch Linux ARM mirror for aarch64 (official Arch ships x86_64 only). */
export const ALARM_MIRROR = "http://mirror.archlinuxarm.org";

export function mirrorFor(arch: LinuxArch): string {
  return arch === "x86_64" ? ARCH_MIRROR : ALARM_MIRROR;
}

export function repoDbUrl(arch: LinuxArch, repo: string): string {
  return arch === "x86_64"
    ? `${ARCH_MIRROR}/${repo}/os/x86_64/${repo}.db`
    : `${ALARM_MIRROR}/aarch64/${repo}/${repo}.db`;
}

export function packageDownloadUrl(arch: LinuxArch, p: Pick<ArchPackage, "repo" | "filename" | "arch">): string {
  return arch === "x86_64" ? packageUrl(p) : `${ALARM_MIRROR}/aarch64/${p.repo}/${p.filename}`;
}

/** Toolchain packages every Linux C/C++ cross sysroot needs, regardless of the desktop closure. */
export const TOOLCHAIN_ROOTS = ["glibc", "linux-api-headers", "gcc-libs", "gcc"] as const;

/** Paths kept when extracting a build sysroot (`--full` keeps everything). */
export const SYSROOT_KEEP = [
  "usr/include/",
  "usr/lib/",
  "usr/lib64/",
  "usr/share/pkgconfig/",
  "usr/share/gir-1.0/",
  "usr/share/vala/",
  "usr/share/wayland",
  "usr/share/glib-2.0/",
  "usr/share/dbus-1/",
  "usr/share/gettext",
  "usr/share/cmake",
  "usr/share/ECM",
  "usr/share/xml/",
  "usr/share/X11/",
  "usr/share/polkit-1/",
  "usr/share/accountsservice/",
  "usr/share/gsettings-schemas/",
  "usr/share/desktop-directories/",
  "usr/share/qt6/",
  "etc/",
];

export function keepPath(path: string, full = false): boolean {
  if (full) return !path.startsWith(".");
  return SYSROOT_KEEP.some(p => path === p.replace(/\/$/, "") || path.startsWith(p));
}

export interface SysrootManifestEntry {
  name: string;
  version: string;
  repo: string;
  url: string;
  sha256: string;
  csize: number;
  isize: number;
}

export interface SysrootManifest {
  schemaVersion: 1;
  kind: "linux-sysroot-manifest";
  arch: LinuxArch;
  roots: string[];
  packages: SysrootManifestEntry[];
  unresolved: string[];
  totals: { packages: number; csize: number; isize: number };
}

export function sysrootManifest(
  index: ArchIndex,
  arch: LinuxArch,
  roots: string[],
  exclude: string[] = [],
): SysrootManifest {
  const all = [...new Set([...TOOLCHAIN_ROOTS, ...roots])];
  const { packages, unresolved } = archClosure(index, all, { exclude, rootMakedepends: true });
  const entries = packages.map(p => ({
    name: p.name,
    version: p.version,
    repo: p.repo,
    url: packageDownloadUrl(arch, p),
    sha256: p.sha256,
    csize: p.csize,
    isize: p.isize,
  }));
  return {
    schemaVersion: 1,
    kind: "linux-sysroot-manifest",
    arch,
    roots: all,
    packages: entries,
    unresolved,
    totals: {
      packages: entries.length,
      csize: entries.reduce((a, e) => a + e.csize, 0),
      isize: entries.reduce((a, e) => a + e.isize, 0),
    },
  };
}

/** Downloads (with a cache) the repository databases and builds the index. */
export async function fetchIndex(arch: LinuxArch, cache: string, refresh = false): Promise<ArchIndex> {
  mkdirSync(cache, { recursive: true });
  const pkgs: ArchPackage[] = [];
  for (const repo of ARCH_REPOS) {
    const file = join(cache, `${arch}-${repo}.db`);
    if (refresh || !existsSync(file) || Date.now() - statSync(file).mtimeMs > DB_MAX_AGE_MS) {
      const res = await fetch(repoDbUrl(arch, repo));
      if (!res.ok) throw new Error(`${repoDbUrl(arch, repo)}: HTTP ${res.status}`);
      writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
    }
    pkgs.push(...parseDb(repo, new Uint8Array(readFileSync(file))));
  }
  return new ArchIndex(pkgs);
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Downloads packages into `cache/pkg`, verifying the sha256 of the repository database. Returns local paths. */
export async function downloadPackages(
  entries: SysrootManifestEntry[],
  cache: string,
  log: (m: string) => void = () => {},
  concurrency = 6,
): Promise<Map<string, string>> {
  const dir = join(cache, "pkg");
  mkdirSync(dir, { recursive: true });
  const out = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const e = entries[next++];
      if (!e) return;
      const file = join(dir, decodeURIComponent(e.url.split("/").pop()!));
      if (existsSync(file) && sha256(readFileSync(file)) === e.sha256) {
        out.set(e.name, file);
        continue;
      }
      const res = await fetch(e.url);
      if (!res.ok) throw new Error(`${e.url}: HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const got = sha256(bytes);
      if (got !== e.sha256)
        throw new Error(`${e.name}: sha256 ${got} does not match the repository database (${e.sha256})`);
      writeFileSync(file, bytes);
      log(`downloaded ${e.name} ${e.version}`);
      out.set(e.name, file);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

export interface ExtractStats {
  files: number;
  symlinksCopied: number;
  symlinksSkipped: number;
  bytes: number;
}

/**
 * Extracts a `.pkg.tar.zst` into `root`. Symlinks become copies of their target (Windows without symlink
 * privilege); links to directories and dangling links are skipped and counted.
 */
export function extractPackage(file: string, root: string, full = false): ExtractStats {
  const tar = Bun.zstdDecompressSync(new Uint8Array(readFileSync(file)));
  const entries = untar(tar);
  const stats: ExtractStats = { files: 0, symlinksCopied: 0, symlinksSkipped: 0, bytes: 0 };
  const written = new Map<string, TarEntry>();
  for (const e of entries) if (e.type === "file" && keepPath(e.path, full)) written.set(e.path, e);
  for (const e of entries) if (e.type === "file" && written.has(e.path)) write(root, e.path, e.data, stats);
  const links = entries.filter(e => (e.type === "symlink" || e.type === "hardlink") && keepPath(e.path, full));
  const find = (path: string, depth = 0): Uint8Array | undefined => {
    if (depth > 8) return undefined;
    const direct = written.get(path);
    if (direct) return direct.data;
    const l = links.find(x => x.path === path);
    if (l) return find(resolveLink(l), depth + 1);
    const onDisk = join(root, path);
    return existsSync(onDisk) && statSync(onDisk).isFile() ? new Uint8Array(readFileSync(onDisk)) : undefined;
  };
  for (const l of links) {
    const target = find(resolveLink(l));
    if (target) {
      write(root, l.path, target, stats);
      stats.symlinksCopied++;
    } else stats.symlinksSkipped++;
  }
  return stats;
}

/** Archive path a link points to: absolute targets are relative to the sysroot, relative ones to the link's dir. */
export function resolveLink(e: Pick<TarEntry, "path" | "link" | "type">): string {
  if (e.type === "hardlink") return e.link;
  return e.link.startsWith("/")
    ? posix.normalize(e.link.slice(1))
    : posix.normalize(posix.join(posix.dirname(e.path), e.link));
}

function write(root: string, path: string, data: Uint8Array, stats: ExtractStats) {
  const dest = join(root, path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  stats.files++;
  stats.bytes += data.length;
}

/** `usr/lib/gcc/<triple>/<ver>` holding crtbeginS.o, or undefined when the gcc package is not installed. */
export function findGccInstallDir(root: string): string | undefined {
  const base = join(root, "usr/lib/gcc");
  if (!existsSync(base)) return undefined;
  for (const triple of readdirSync(base))
    for (const ver of readdirSync(join(base, triple)))
      if (existsSync(join(base, triple, ver, "crtbeginS.o"))) return join(base, triple, ver).replaceAll("\\", "/");
  return undefined;
}

/**
 * Build-machine tools that pkg-config variables of target packages point at (`${prefix}/bin/glib-mkenums` becomes
 * `<sysroot>/usr/bin/glib-mkenums` under PKG_CONFIG_SYSROOT_DIR). They must run on the host, so they are linked in
 * from the host PATH, never taken from the target packages.
 */
export const HOST_TOOLS = [
  "glib-mkenums",
  "glib-genmarshal",
  "glib-compile-resources",
  "glib-compile-schemas",
  "gdbus-codegen",
  "gresource",
  "glib-gettextize",
  "wayland-scanner",
  "g-ir-scanner",
  "g-ir-compiler",
  "g-ir-annotation-tool",
  "qtpaths6",
  "moc",
  "rcc",
  "uic",
];

export interface ShimResult {
  linked: string[];
  present: string[];
  missing: string[];
}

/** Links host tools into `<sysroot>/usr/bin` (symlinks, or `.cmd`-free skip on Windows where they are only reported). */
export function shimHostTools(
  sysroot: string,
  find: (name: string) => string | null = n => Bun.which(n),
  tools: string[] = HOST_TOOLS,
  link: (target: string, path: string) => void = symlinkSync,
): ShimResult {
  const bin = join(sysroot, "usr/bin");
  mkdirSync(bin, { recursive: true });
  const r: ShimResult = { linked: [], present: [], missing: [] };
  for (const t of tools) {
    const dest = join(bin, t);
    let exists = false;
    try {
      lstatSync(dest);
      exists = true;
    } catch {}
    const host = find(t);
    if (exists && host) {
      // A target-architecture binary in the sysroot cannot run on the build machine: replace it by the host tool.
      try {
        unlinkSync(dest);
        exists = false;
      } catch {}
    }
    if (exists) r.present.push(t);
    else if (!host) r.missing.push(t);
    else {
      try {
        link(host, dest);
        r.linked.push(t);
      } catch {
        r.missing.push(t);
      }
    }
  }
  return r;
}
