/**
 * posix: the POSIX userland (coreutils, findutils, diffutils, sed/awk/grep, ripgrep, fd, sd) as pinned portable binaries.
 *
 * Replaces the userland that MSYS2, Cygwin, GnuWin32 and Git for Windows' usr/bin supplied to scripts. Nothing is installed
 * system-wide: everything lives under the buncc cache and is exposed as one directory of shims (`buncc env posix`).
 * Sources (checked 2026-10-29 with `gh api`): uutils/coreutils 0.12.0, uutils/findutils 0.10.0, uutils/diffutils v0.6.0,
 * BurntSushi/ripgrep 15.2.0, sharkdp/fd v10.5.0, chmln/sd v1.1.0, busybox-w32 FRP-6354-g5f09fb446 (frippery.org).
 * GitHub publishes a SHA-256 digest per asset; buncc verifies it before extraction.
 */
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { findInstalled, installGithubTool, type GithubToolSpec } from "./_github.ts";
import { download, exeSuffix, hostArch, missing, pathVar, prependPath, toolsDir, which } from "./_shared.ts";
import type { Context, Detection, InstallPlan, Platform, Provider } from "./types.ts";

type Arch = "x64" | "arm64" | "x86";

function triple(platform: Platform, arch: Arch, libc: "musl" | "gnu" = "musl"): string | undefined {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : "i686";
  if (platform === "win32") return `${cpu}-pc-windows-msvc`;
  if (platform === "darwin") return arch === "x86" ? undefined : `${cpu}-apple-darwin`;
  return `${cpu}-unknown-linux-${libc}`;
}
const archiveExt = (platform: Platform) => (platform === "win32" ? "zip" : "tar.gz");

export const uutilsCoreutils: GithubToolSpec = {
  id: "uutils-coreutils",
  repo: "uutils/coreutils",
  binary: "coreutils",
  asset(tag, platform, arch) {
    const t = triple(platform, arch);
    return t ? `coreutils-${tag}-${t}.${archiveExt(platform)}` : undefined;
  },
};
export const uutilsFindutils: GithubToolSpec = {
  id: "uutils-findutils",
  repo: "uutils/findutils",
  binary: "find",
  asset(_tag, platform, arch) {
    const t = triple(platform, arch);
    return t ? new RegExp(`^findutils-.*${t}\\.(zip|tar\\.gz)$`) : undefined;
  },
};
export const uutilsDiffutils: GithubToolSpec = {
  id: "uutils-diffutils",
  repo: "uutils/diffutils",
  binary: "diffutils",
  asset(_tag, platform, arch) {
    const t = triple(platform, arch);
    return t ? new RegExp(`^diffutils-.*${t}\\.(zip|tar\\.gz)$`) : undefined;
  },
};
export const ripgrepRelease: GithubToolSpec = {
  id: "ripgrep",
  repo: "BurntSushi/ripgrep",
  binary: "rg",
  asset(tag, platform, arch) {
    const t = triple(platform, arch);
    return t ? `ripgrep-${tag}-${t}.${archiveExt(platform)}` : undefined;
  },
};
export const fdRelease: GithubToolSpec = {
  id: "fd",
  repo: "sharkdp/fd",
  binary: "fd",
  asset(tag, platform, arch) {
    const t = triple(platform, arch, "musl");
    return t ? `fd-${tag}-${t}.${archiveExt(platform)}` : undefined;
  },
};
export const sdRelease: GithubToolSpec = {
  id: "sd",
  repo: "chmln/sd",
  binary: "sd",
  asset(tag, platform, arch) {
    const t = triple(platform, arch, "musl");
    return t ? `sd-${tag}-${t}.${archiveExt(platform)}` : undefined;
  },
};

/** busybox-w32 has no GitHub release; frippery.org publishes SHA256SUM next to the binaries (hash read 2026-10-29). */
export const BUSYBOX = {
  tag: "FRP-6354-g5f09fb446",
  files: {
    x64: {
      name: "busybox-w64u-FRP-6354-g5f09fb446.exe",
      sha256: "36b266923fc5765b42f5f981319f39568498fba60b53ccf26e8fc1e575e2a9a9",
    },
  } as Partial<Record<Arch, { name: string; sha256: string }>>,
  baseUrl: "https://frippery.org/files/busybox/",
};

/** Applets served by the uutils multicall binary (one shim per name). The subset build scripts use; `coreutils --list` has more. */
export const COREUTILS_APPLETS = [
  "basename",
  "cat",
  "chmod",
  "cksum",
  "comm",
  "cp",
  "cut",
  "date",
  "dd",
  "df",
  "dirname",
  "du",
  "echo",
  "env",
  "expand",
  "expr",
  "false",
  "fold",
  "head",
  "id",
  "install",
  "join",
  "ln",
  "ls",
  "md5sum",
  "mkdir",
  "mktemp",
  "mv",
  "nl",
  "nproc",
  "od",
  "paste",
  "printf",
  "pwd",
  "readlink",
  "realpath",
  "rm",
  "rmdir",
  "seq",
  "sha1sum",
  "sha256sum",
  "sha512sum",
  "shuf",
  "sleep",
  "sort",
  "split",
  "stat",
  "tac",
  "tail",
  "tee",
  "test",
  "touch",
  "tr",
  "true",
  "truncate",
  "uname",
  "uniq",
  "wc",
  "whoami",
  "yes",
] as const;
/** Applets uutils does not carry (sed, awk, grep, tar, ...): busybox-w32, Windows only. */
export const BUSYBOX_APPLETS = [
  "sed",
  "awk",
  "grep",
  "egrep",
  "fgrep",
  "patch",
  "tar",
  "gzip",
  "gunzip",
  "which",
  "less",
  "unzip",
  "ash",
  "sh",
] as const;
export const FINDUTILS_APPLETS = ["find", "xargs"] as const;
export const DIFFUTILS_APPLETS = ["diff", "cmp"] as const;

export interface ShimEntry {
  name: string;
  /** Executable the shim stands for. */
  target: string;
  /** "multicall": argv[0] selects the applet; "alias": the target is a stand-alone program. */
  kind: "multicall" | "alias";
}

/** Which shims go where, without touching the disk. `have` maps tool id to its binary path. */
export function planShims(have: Partial<Record<string, string>>, platform: Platform): ShimEntry[] {
  const out = new Map<string, ShimEntry>();
  const add = (names: readonly string[], target: string | undefined, kind: ShimEntry["kind"]) => {
    if (!target) return;
    for (const name of names) if (!out.has(name)) out.set(name, { name, target, kind });
  };
  add(COREUTILS_APPLETS, have["uutils-coreutils"], "multicall");
  add(FINDUTILS_APPLETS, have["uutils-findutils"], "alias");
  add(DIFFUTILS_APPLETS, have["uutils-diffutils"], "multicall");
  if (platform === "win32") add(BUSYBOX_APPLETS, have.busybox, "multicall");
  for (const id of ["ripgrep", "fd", "sd"] as const) {
    const bin = have[id];
    const name = id === "ripgrep" ? "rg" : id;
    if (bin) out.set(name, { name, target: bin, kind: "alias" });
  }
  return [...out.values()];
}

/** Materialise one shim: hard link (same volume), else copy, else symlink. Multicall binaries dispatch on the file name. */
export function writeShim(dir: string, entry: ShimEntry): void {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, entry.name + exeSuffix);
  rmSync(dest, { force: true });
  try {
    linkSync(entry.target, dest);
    return;
  } catch {}
  try {
    copyFileSync(entry.target, dest);
    return;
  } catch {}
  symlinkSync(entry.target, dest);
}

export function shimDir(version: string): string {
  return join(toolsDir("posix"), version, "bin");
}

const STACK: { spec: GithubToolSpec; key: string }[] = [
  { spec: uutilsCoreutils, key: "uutils-coreutils" },
  { spec: uutilsFindutils, key: "uutils-findutils" },
  { spec: uutilsDiffutils, key: "uutils-diffutils" },
  { spec: ripgrepRelease, key: "ripgrep" },
  { spec: fdRelease, key: "fd" },
  { spec: sdRelease, key: "sd" },
];

export async function ensureBusybox(
  options: { fetcher?: typeof fetch; arch?: Arch } = {},
): Promise<string | undefined> {
  const file = BUSYBOX.files[options.arch ?? hostArch()];
  if (!file) return undefined;
  const dest = join(toolsDir("busybox"), BUSYBOX.tag, "busybox.exe");
  if (existsSync(dest)) return dest;
  const bytes = await download(BUSYBOX.baseUrl + file.name, file.sha256, "sha256", options.fetcher);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  return dest;
}

export interface PosixInstall {
  dir: string;
  tools: Record<string, string>;
  shims: string[];
  skipped: string[];
}

/** Download every tool of the stack (checksum verified) and build the shim directory. Safe to repeat. */
export async function ensurePosix(
  options: { platform?: Platform; arch?: Arch; fetcher?: typeof fetch; only?: string[] } = {},
): Promise<PosixInstall> {
  const platform: Platform =
    options.platform ?? (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
  const tools: Record<string, string> = {};
  const skipped: string[] = [];
  for (const { spec, key } of STACK) {
    if (options.only && !options.only.includes(key)) continue;
    try {
      const done = await installGithubTool(spec, { platform, arch: options.arch, fetcher: options.fetcher });
      if (done.bin) tools[key] = done.bin;
      else skipped.push(`${key}: binary ${spec.binary} not in archive`);
    } catch (error) {
      skipped.push(`${key}: ${(error as Error).message}`);
    }
  }
  if (platform === "win32" && (!options.only || options.only.includes("busybox"))) {
    try {
      const bb = await ensureBusybox({ fetcher: options.fetcher, arch: options.arch });
      if (bb) tools.busybox = bb;
    } catch (error) {
      skipped.push(`busybox: ${(error as Error).message}`);
    }
  }
  const core = tools["uutils-coreutils"];
  const version = `${BUSYBOX.tag}+${core ? basename(dirname(core)) : "none"}`;
  const dir = shimDir(version.replace(/[^\w.+-]/g, "_"));
  const shims = planShims(tools, platform);
  for (const shim of shims) writeShim(dir, shim);
  return { dir, tools, shims: shims.map(s => s.name), skipped };
}

/** Newest shim directory already on disk, if any. */
export function findShimDir(): string | undefined {
  const base = toolsDir("posix");
  try {
    const versions = readdirSync(base)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .reverse();
    for (const v of versions) {
      const d = join(base, v, "bin");
      if (existsSync(d)) return d;
    }
  } catch {}
  return undefined;
}

export const posixProvider: Provider = {
  id: "posix",
  description:
    "POSIX userland as pinned portable binaries (uutils coreutils/findutils/diffutils, busybox-w32, ripgrep, fd, sd)",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx: Context): Promise<Detection> {
    const dir = findShimDir();
    if (dir && existsSync(join(dir, "ls" + exeSuffix))) {
      const stack = STACK.filter(s => findInstalled(s.spec)).map(s => s.key);
      return { found: true, path: dir, version: BUSYBOX.tag, notes: [`provisioned: ${stack.join(", ")}`] };
    }
    const sys = which("ls", ctx) ?? undefined;
    if (ctx.platform !== "win32" && sys)
      return { found: true, path: sys, notes: ["system POSIX userland (no shim needed)"] };
    return missing("buncc env posix --ensure");
  },
  install(): InstallPlan {
    return { commands: [["buncc", "env", "posix", "--ensure"]] };
  },
  async env(ctx: Context) {
    const dir = findShimDir();
    return dir ? { PATH: prependPath(pathVar(ctx), [dir]), BUNCC_POSIX_DIR: dir } : {};
  },
};
