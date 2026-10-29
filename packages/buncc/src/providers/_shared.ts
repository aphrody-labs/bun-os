import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { cacheDir } from "../lock.ts";
import { run } from "../process.ts";
import type { Context, Detection } from "./types.ts";

/** Directory where providers keep tools they downloaded themselves. */
export function toolsDir(...parts: string[]): string {
  return join(cacheDir(), "tools", ...parts);
}

/** First `major.minor[.patch[.build]]` found in a tool's `--version` output. */
export function parseVersion(text: string): string | undefined {
  return /(\d+\.\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?)/.exec(text)?.[1];
}

/** Locate an executable on the context PATH (falls back to the process PATH). */
export function which(name: string, ctx?: Context): string | null {
  return Bun.which(name, { PATH: ctx?.env.PATH ?? ctx?.env.Path ?? Bun.env.PATH ?? "" } as never) ?? Bun.which(name);
}

/** Run `program args` and return the version it prints; undefined when it cannot run. */
export async function probeVersion(
  program: string,
  args: string[] = ["--version"],
  ctx?: Context,
): Promise<string | undefined> {
  const result = await run([program, ...args], { env: ctx?.env, output: "capture", timeoutMs: 20_000 });
  if (result.code !== 0 && !result.stdout && !result.stderr) return undefined;
  return parseVersion(result.stdout || result.stderr);
}

export function missing(fixHint: string): Detection {
  return { found: false, fixHint };
}

/** Prepend directories to a PATH-style value without duplicating entries. */
export function prependPath(current: string | undefined, dirs: string[]): string {
  const have = new Set((current ?? "").split(delimiter).filter(Boolean));
  const add = dirs.filter(dir => dir && !have.has(dir));
  return [...add, ...(current ? [current] : [])].join(delimiter);
}

export function pathVar(ctx: Context): string | undefined {
  return ctx.env.PATH ?? ctx.env.Path;
}

/** Version pinned for `id` in `<root>/buncc.toolchain.json` (`{"tools": {"cmake": "4.4.4"}}` or `{"cmake": "4.4.4"}`). */
export async function pinFromToolchain(ctx: Context, id: string): Promise<string | undefined> {
  const file = join(ctx.root, "buncc.toolchain.json");
  if (!existsSync(file)) return undefined;
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const tools = (json.tools ?? json) as Record<string, unknown>;
    const value = tools[id];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const v = value as { version?: unknown; min?: unknown };
      if (typeof v.version === "string") return v.version;
      if (typeof v.min === "string") return v.min;
    }
  } catch {}
  return undefined;
}

export type Algorithm = "sha256" | "sha512";

export function digest(bytes: Uint8Array, algorithm: Algorithm): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

export class ChecksumError extends Error {
  constructor(
    readonly url: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`${url}: checksum is ${actual}, expected ${expected}`);
  }
}

/** Download `url` and verify it. Throws ChecksumError on a mismatch, so nothing unverified is ever written. */
export async function download(
  url: string,
  expected: string,
  algorithm: Algorithm = "sha256",
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = digest(bytes, algorithm);
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new ChecksumError(url, expected, actual);
  return bytes;
}

/** Extract .tar.gz/.tgz/.tar.xz/.zip with the system bsdtar/tar (Windows ships bsdtar as tar.exe, which also reads zip). */
export async function extractArchive(archive: string, into: string): Promise<void> {
  mkdirSync(into, { recursive: true });
  const tar =
    process.platform === "win32"
      ? join(Bun.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : (Bun.which("bsdtar") ?? Bun.which("tar") ?? "tar");
  const result = await run([tar, "-xf", archive, "-C", into], { output: "capture", timeoutMs: 600_000 });
  if (result.code !== 0)
    throw new Error(`extract ${basename(archive)}: ${result.stderr.trim() || `exit ${result.code}`}`);
}

/**
 * Download a pinned archive and extract it atomically into `dest` (a temporary sibling directory is renamed into place,
 * so a failed or interrupted install leaves nothing behind). Returns `dest`.
 */
export async function fetchPinned(options: {
  url: string;
  hash: string;
  algorithm?: Algorithm;
  dest: string;
  /** Directory inside the archive to hoist (e.g. "cmake-4.4.4-windows-x86_64"). */
  strip?: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const bytes = await download(options.url, options.hash, options.algorithm ?? "sha256", options.fetcher);
  const work = `${options.dest}.partial-${process.pid}`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const name = basename(new URL(options.url).pathname);
  const archive = join(work, name);
  await Bun.write(archive, bytes);
  const out = join(work, "x");
  await extractArchive(archive, out);
  const root = options.strip ? join(out, options.strip) : out;
  if (!existsSync(root)) throw new Error(`${options.url}: archive has no ${options.strip}`);
  rmSync(options.dest, { recursive: true, force: true });
  mkdirSync(dirname(options.dest), { recursive: true });
  renameSync(root, options.dest);
  rmSync(work, { recursive: true, force: true });
  return options.dest;
}

/** Rust-style os/arch of the running machine. */
export function hostArch(): "x64" | "arm64" | "x86" {
  return process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "x86" : "x64";
}

export const exeSuffix = process.platform === "win32" ? ".exe" : "";

export type PackageManager = "pacman" | "apt" | "dnf" | "apk" | "brew" | "winget";

/** Package names per manager; a tool lists only the managers that carry it. */
export type PackageNames = Partial<Record<PackageManager, string | string[]>>;

/** The system package manager of this machine (winget on Windows; pacman, apt-get, dnf, apk or brew elsewhere). */
export function detectPackageManager(
  platform: string = process.platform,
  has: (cmd: string) => boolean = c => !!Bun.which(c),
): PackageManager | undefined {
  if (platform === "win32" || platform === "win") return "winget";
  if (platform === "darwin") return has("brew") ? "brew" : undefined;
  for (const [cmd, pm] of [
    ["pacman", "pacman"],
    ["apt-get", "apt"],
    ["dnf", "dnf"],
    ["apk", "apk"],
  ] as const)
    if (has(cmd)) return pm;
  return undefined;
}

/** Unattended install command for packages. `sudo` is added when not running as root. */
export function packageInstallCommand(
  pm: PackageManager,
  names: string | string[],
  root = typeof process.getuid === "function" && process.getuid() === 0,
): string[] {
  const pkgs = Array.isArray(names) ? names : [names];
  const sudo = root || pm === "brew" || pm === "winget" ? [] : ["sudo"];
  switch (pm) {
    case "pacman":
      return [...sudo, "pacman", "-S", "--needed", "--noconfirm", ...pkgs];
    case "apt":
      return [...sudo, "apt-get", "install", "-y", ...pkgs];
    case "dnf":
      return [...sudo, "dnf", "install", "-y", ...pkgs];
    case "apk":
      return ["apk", "add", ...pkgs];
    case "brew":
      return ["brew", "install", ...pkgs];
    case "winget":
      return [
        "winget",
        "install",
        "--id",
        pkgs[0]!,
        "--exact",
        "--source",
        "winget",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ];
  }
}

/** One command per package for winget (it installs a single id per call), one command for the Unix managers. */
export function installPlanFor(names: PackageNames, platform: string = process.platform): string[][] {
  const pm = detectPackageManager(platform);
  if (!pm) return [];
  const spec = names[pm];
  if (!spec) return [];
  if (pm === "winget") return (Array.isArray(spec) ? spec : [spec]).map(id => packageInstallCommand("winget", id));
  return [packageInstallCommand(pm, spec)];
}
