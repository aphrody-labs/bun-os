// SPDX-License-Identifier: Apache-2.0
// Windows Bun version management and package-manager hygiene, twin of bun-hygiene.sh (Linux user timer). Same policy
// (docs/operations/infra/update/BUN.md): the newest stable oven-sh/bun release that is at least
// --min-age-days old (bunfig minimumReleaseAge = 3 days); every host applies the same rule and converges.
//
//   bun scripts/tools/bun-hygiene.ts [--min-age-days 3] [--dry-run]
//
// The upgrade is native: release zip, SHA-256 against the release SHA256SUMS.txt, extraction by the system bsdtar, the
// running bun.exe renamed aside (Windows allows renaming a running image, not replacing it), the new one moved in,
// bunx/node/npm/npx hardlinks relinked, then `bun completions`. Reports global packages, outdated and untrusted
// lifecycle scripts; prunes cache entries unused for 30 days only above 5 GB. Never touches a checkout or lockfile.
// Scheduled daily at 05:30 by the boot catalog entry `AphrodyBunHygiene` (infra/config/service-catalog.json,
// `aphrody infra boot`): S4U task, so no window can appear. Log: %LOCALAPPDATA%\aphrody\log\bun-hygiene.log.
// oxlint-disable no-await-in-loop -- sequential by design: one replacement, then ordered reports.
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

export type Release = {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
};

/** Stable release tags of upstream Bun (`bun-v1.4.4`); canary and other tags are ignored. */
export const RUNTIME_TAG = /^bun-v\d+\.\d+\.\d+$/;
const ALIASES = ["bunx.exe", "node.exe", "npm.exe", "npx.exe"] as const;
const CACHE_MAX_BYTES = 5 * 1024 ** 3;
const CACHE_IDLE_DAYS = 30;
const DAY_MS = 86_400_000;

/** Newest stable runtime release published more than `minAgeDays` ago. */
export function eligibleTag(releases: Release[], now: number, minAgeDays: number): string | undefined {
  return releases
    .filter(r => !r.prerelease && !r.draft && RUNTIME_TAG.test(r.tag_name) && r.published_at)
    .map(r => ({ tag: r.tag_name, at: Date.parse(r.published_at!) }))
    .filter(r => now - r.at > minAgeDays * DAY_MS)
    .toSorted((a, b) => b.at - a.at)[0]?.tag;
}

/** `bun --version` (`1.4.4`) as its release tag. */
export const tagOf = (version: string) => `bun-v${version.trim().split(/[-+]/)[0]}`;

const runtimeParts = (t: string) => (RUNTIME_TAG.test(t) ? t.match(/\d+/g)!.map(Number) : undefined);

/** `bun-vX.Y.Z` is newer than `current` (a non-release current tag is always older). */
export function isNewer(tag: string, current: string): boolean {
  const next = runtimeParts(tag);
  const now = runtimeParts(current);
  if (!next) return false;
  if (!now) return true;
  const diff = next.map((n, i) => n - (now[i] ?? 0)).find(d => d !== 0);
  return (diff ?? 0) > 0;
}

/** Expected digest of `asset` in a `sha256sum` listing. */
export function expectedSum(sums: string, asset: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match && match[2]!.split(/[\\/]/).pop() === asset) return match[1]!.toLowerCase();
  }
  return undefined;
}

/**
 * Puts `staged` in place of `binDir\bun.exe` and relinks the aliases. Every replaced file is renamed to
 * `<name>.old-<stamp>` first, so a running image is never overwritten; leftovers are removed by `sweepOld`.
 */
export function swapExecutable(binDir: string, staged: string, stamp = Date.now()): string[] {
  const bun = join(binDir, "bun.exe");
  const aside = (path: string) => {
    if (existsSync(path)) renameSync(path, `${path}.old-${stamp}`);
  };
  aside(bun);
  try {
    renameSync(staged, bun);
  } catch (error) {
    if (existsSync(`${bun}.old-${stamp}`)) renameSync(`${bun}.old-${stamp}`, bun);
    throw error;
  }
  const linked: string[] = [];
  for (const alias of ALIASES) {
    const link = join(binDir, alias);
    if (alias !== "bunx.exe" && !existsSync(link)) continue;
    aside(link);
    linkSync(bun, link);
    linked.push(alias);
  }
  return linked;
}

/** Removes the images renamed aside by earlier upgrades; ones still running stay until the next run. */
export function sweepOld(binDir: string): string[] {
  const removed: string[] = [];
  for (const name of existsSync(binDir) ? readdirSync(binDir) : []) {
    if (!/\.exe\.old-\d+$/.test(name)) continue;
    try {
      rmSync(join(binDir, name), { force: true });
      removed.push(name);
    } catch {
      // still mapped by a running process
    }
  }
  return removed;
}

function treeSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    try {
      total += statSync(join(entry.parentPath, entry.name)).size;
    } catch {
      // removed while walking
    }
  }
  return total;
}

/** Top-level cache entries not accessed for 30 days, when the cache is above 5 GB. */
export function cachePrunable(cache: string, now: number, size = treeSize(cache)): string[] {
  if (size <= CACHE_MAX_BYTES) return [];
  const cutoff = now - CACHE_IDLE_DAYS * DAY_MS;
  return readdirSync(cache, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(cache, entry.name))
    .filter(path => statSync(path).atimeMs < cutoff);
}

async function run(argv: string[], cwd?: string, env?: Record<string, string>) {
  const proc = Bun.spawn(argv, {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: out.trim(), text: `${out}${err}`.trim() };
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function install(tag: string, binDir: string, log: (line: string) => void): Promise<void> {
  const target = `bun-windows-${process.arch === "arm64" ? "aarch64" : "x64"}`;
  const base = `https://github.com/oven-sh/bun/releases/download/${tag}`;
  const zip = await download(`${base}/${target}.zip`);
  const want = expectedSum(new TextDecoder().decode(await download(`${base}/SHASUMS256.txt`)), `${target}.zip`);
  const got = new Bun.CryptoHasher("sha256").update(zip).digest("hex");
  if (!want || want !== got) throw new Error(`checksum mismatch for ${target}.zip`);
  const work = mkdtempSync(join(tmpdir(), "aphrody-bun-"));
  try {
    const archive = join(work, `${target}.zip`);
    await Bun.write(archive, zip);
    // System bsdtar (not a Git/MSYS GNU tar from PATH) extracts zip archives.
    const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const extracted = await run([tar, "-xf", archive, "-C", work]);
    if (extracted.code !== 0) throw new Error(`extraction failed: ${extracted.text}`);
    const fresh = join(work, target, "bun.exe");
    const version = await run([fresh, "--version"]);
    if (version.code !== 0 || tagOf(version.out) !== tag)
      throw new Error(`downloaded bun reports ${version.text || `exit ${version.code}`}, expected ${tag}`);
    const staged = join(binDir, `bun.exe.new-${process.pid}`);
    copyFileSync(fresh, staged);
    log(`relinked ${swapExecutable(binDir, staged).join(", ")}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const bun = join(binDir, "bun.exe");
  await run([bun, "completions"], undefined, { IS_BUN_AUTO_UPDATE: "1" });
  log(`bun now ${(await run([bun, "--revision"])).out}`);
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  if (process.platform !== "win32")
    throw new Error("Windows only; Linux hosts run scripts/tools/bun-hygiene.sh (user timer aphrody-bun-hygiene)");
  const at = argv.indexOf("--min-age-days");
  const minAgeDays = at >= 0 ? Number(argv[at + 1]) : 3;
  if (!Number.isFinite(minAgeDays) || minAgeDays < 0) throw new Error("--min-age-days expects a number");
  const dryRun = argv.includes("--dry-run");
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const logDir = join(local, "aphrody", "log");
  mkdirSync(logDir, { recursive: true });
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    appendFileSync(join(logDir, "bun-hygiene.log"), `${stamped}\n`);
  };
  const block = (title: string, text: string) =>
    log(
      `${title}\n${text
        .split(/\r?\n/)
        .map(l => `  ${l}`)
        .join("\n")}`,
    );

  const binDir = join(process.env.BUN_INSTALL ?? join(homedir(), ".bun"), "bin");
  const bun = join(binDir, "bun.exe");
  const current = tagOf((await run([bun, "--version"])).out);
  log(`start host=${hostname()} bun=${current}${dryRun ? " dry-run" : ""}`);
  for (const name of sweepOld(binDir)) log(`removed ${name}`);

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const response = await fetch("https://api.github.com/repos/oven-sh/bun/releases?per_page=30", {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
  const target = eligibleTag((await response.json()) as Release[], Date.now(), minAgeDays);
  // Never downgrades: a newer build installed by hand stays until an eligible release passes it.
  if (target && isNewer(target, current)) {
    log(`upgrade ${current} -> ${target}`);
    if (!dryRun) await install(target, binDir, log);
  } else {
    log(`version ok cur=${current} eligible=${target ?? "unknown"}`);
  }

  block("global packages", (await run([bun, "pm", "ls", "-g"])).text);
  const global = join(homedir(), ".bun", "install", "global");
  if (existsSync(global)) block("outdated (global)", (await run([bun, "outdated"], global)).text);
  block("untrusted lifecycle scripts", (await run([bun, "pm", "-g", "untrusted"])).text);

  const cache = (await run([bun, "pm", "cache"])).out.split(/\r?\n/).pop() ?? "";
  if (cache && existsSync(cache)) {
    const size = treeSize(cache);
    log(`cache ${cache} ${(size / 1024 ** 3).toFixed(1)}GB`);
    const stale = cachePrunable(cache, Date.now(), size);
    if (stale.length && !dryRun) {
      for (const path of stale) rmSync(path, { recursive: true, force: true });
      log(`pruned ${stale.length} entries unused for ${CACHE_IDLE_DAYS} days`);
    }
  }
  log("lockfile verification belongs to the selected checkout gates; hygiene does not install workspace dependencies");
  log("done");
  return 0;
}

if (import.meta.main) {
  main().then(
    code => process.exit(code),
    (error: unknown) => {
      console.error(`bun-hygiene: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
