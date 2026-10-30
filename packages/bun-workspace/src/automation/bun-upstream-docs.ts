// SPDX-License-Identifier: Apache-2.0
/**
 * Bun documentation of Aphrody: `docs/` of upstream oven-sh/bun, read in place.
 * Aphrody keeps no copy of it; `docs/reference/upstream-bun` holds only `APHRODY-FORK.md`, the Bun
 * `LICENSE.md` (shipped by scripts/release/release.ts) and `SOURCE.json`, the pinned fork commit.
 *
 * Usage: bun packages/bun-workspace/src/automation/bun-upstream-docs.ts [--root <repository>]
 *          [--source <bun checkout>] [--ref <branch-or-commit>] [--check]
 *        bun packages/bun-workspace/src/automation/bun-upstream-docs.ts --resolve [--no-download] [--ref <commit>]
 *
 * The default mode pins the last commit touching `docs/` on `--ref` (`origin/main` of a local checkout,
 * else `main` of a fresh clone) and copies `LICENSE.md`; `--check` compares without writing.
 * `--resolve` prints the corpus directory chosen by {@link resolveBunDocs}.
 *
 * Corpus resolution ({@link resolveBunDocs}, same order as the Rust crate `aphrody-bun-docs`):
 * `APHRODY_BUN_DOCS` (authoritative), `docs/` of the selected fork checkout (`APHRODY_BUN_CHECKOUT`
 * or a sibling of the configured workspace), an installed corpus `<data>/aphrody/bun/docs`, then a versioned download: a partial clone
 * of `docs/` at the pinned commit in `<data>/aphrody/bun/docs-<commit12>`, announced on stderr and
 * disabled by `APHRODY_BUN_DOCS_FETCH=0`. `<data>` is `%APPDATA%` on Windows, else `$XDG_DATA_HOME` or
 * `~/.local/share`.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Pin directory: APHRODY-FORK.md, LICENSE.md and SOURCE.json only. */
export const BUN_PIN_DIR = "crates/aphrody-bun-docs/data";
export const FORK_URL = "https://github.com/oven-sh/bun.git";
const FORK_SOURCE = "https://github.com/oven-sh/bun";
const KEEP = new Set(["APHRODY-FORK.md", "LICENSE.md", "SOURCE.json"]);
/** Repository-root files copied next to the pin (Bun licence, shipped by scripts/release/release.ts). */
const ROOT_FILES = ["LICENSE.md"];
/** Pages, `docs.json` and snippets of `docs/` plus the licence; the image directories (22 MB) stay remote. */
export const SPARSE_PATTERNS = ["/docs/", "!/docs/images/", "!/docs/icons/", "!/docs/logo/", "/LICENSE.md"];
const DEFAULT_PIN = join(import.meta.dir, "../../../..", BUN_PIN_DIR, "SOURCE.json");

type Env = Record<string, string | undefined>;

export interface BunDocsPin {
  source: string;
  repository: string;
  path: string;
  commit: string;
  date: string;
  command: string;
  files: Record<string, string>;
}

export type BunDocsSource = "override" | "checkout" | "installed" | "download";

export interface ResolvedBunDocs {
  dir: string;
  source: BunDocsSource;
}

export interface ResolveBunDocsOptions {
  env?: Env;
  platform?: string;
  /** false: never download; throw an explicit error instead. Default: unless `APHRODY_BUN_DOCS_FETCH=0`. */
  download?: boolean;
  /** Commit or branch to download; default `APHRODY_BUN_DOCS_REF`, else the pinned commit, else `main`. */
  ref?: string;
  /** SOURCE.json holding the pin; default the one of this repository. */
  pinFile?: string;
  log?: (message: string) => void;
}

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`);
  return proc.stdout.toString().trim();
}

/** Explicit fork, environment override, or sibling of the configured workspace. */
export function localBunCheckout(
  explicit?: string,
  env: Env = process.env,
  _platform: string = process.platform,
): string | undefined {
  if (explicit) return resolve(explicit);
  if (env.APHRODY_BUN_CHECKOUT?.trim()) return resolve(env.APHRODY_BUN_CHECKOUT.trim());
  const workspace = env.APHRODY_WORKSPACE_ROOT?.trim() || env.APHRODY_ROOT?.trim();
  if (workspace) {
    const sibling = resolve(workspace, "..", "bun");
    if (existsSync(join(sibling, "docs", "docs.json"))) return sibling;
  }
  return undefined;
}

/** `<data>/aphrody/bun`: `%APPDATA%` on Windows, else `$XDG_DATA_HOME` (absolute) or `~/.local/share`. */
export function bunDataDir(env: Env = process.env, platform: string = process.platform): string | undefined {
  if (platform === "win32") return env.APPDATA ? join(env.APPDATA, "aphrody", "bun") : undefined;
  const xdg = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : undefined;
  const home = env.HOME ?? homedir();
  const data = xdg ?? (home ? join(home, ".local", "share") : undefined);
  return data ? join(data, "aphrody", "bun") : undefined;
}

export async function readBunDocsPin(pinFile: string = DEFAULT_PIN): Promise<BunDocsPin | undefined> {
  const file = Bun.file(pinFile);
  return (await file.exists()) ? ((await file.json()) as BunDocsPin) : undefined;
}

const isDocsSite = (dir: string): boolean => existsSync(join(dir, "docs.json"));

function run(args: string[], cwd?: string): void {
  const proc = Bun.spawnSync(cwd ? ["git", "-C", cwd, ...args] : ["git", ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`);
}

/** Partial clone of `docs/` (and `LICENSE.md`) of the fork at `ref`, swapped into `dest` once complete. */
export async function fetchForkDocs(ref: string, dest: string, url: string = FORK_URL): Promise<string> {
  await mkdir(dirname(dest), { recursive: true });
  const staging = `${dest}.partial-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  try {
    run(["clone", "--quiet", "--no-checkout", "--depth", "1", "--filter=blob:none", "--sparse", url, staging]);
    run(["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS], staging);
    run(["fetch", "--quiet", "--depth", "1", "origin", ref], staging);
    run(["checkout", "--quiet", "--detach", "FETCH_HEAD"], staging);
    if (!isDocsSite(join(staging, "docs"))) throw new Error(`${url} @ ${ref} has no docs/docs.json`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await rm(dest, { recursive: true, force: true });
  await rename(staging, dest);
  return dest;
}

/** Corpus directory of the Bun docs; see the module comment for the order. Never fails silently. */
export async function resolveBunDocs(options: ResolveBunDocsOptions = {}): Promise<ResolvedBunDocs> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (env.APHRODY_BUN_DOCS) {
    const dir = resolve(env.APHRODY_BUN_DOCS);
    if (!existsSync(dir)) throw new Error(`APHRODY_BUN_DOCS=${dir} does not exist`);
    return { dir, source: "override" };
  }
  const tried: string[] = [];
  const checkout = localBunCheckout(undefined, env, platform);
  if (checkout) {
    const dir = join(checkout, "docs");
    if (isDocsSite(dir)) return { dir, source: "checkout" };
    tried.push(dir);
  }
  const data = bunDataDir(env, platform);
  if (!data) throw new Error("Bun docs not found: no fork checkout and no user data directory to install them");
  const installed = join(data, "docs");
  if (existsSync(installed)) return { dir: installed, source: "installed" };
  tried.push(installed);
  const pin = await readBunDocsPin(options.pinFile);
  const ref = options.ref ?? env.APHRODY_BUN_DOCS_REF ?? pin?.commit ?? "main";
  const cache = join(data, `docs-${ref.replace(/[^\w.-]/g, "_").slice(0, 12)}`);
  const cached = join(cache, "docs");
  if (isDocsSite(cached)) return { dir: cached, source: "download" };
  tried.push(cached);
  const download = options.download ?? env.APHRODY_BUN_DOCS_FETCH !== "0";
  if (!download)
    throw new Error(
      `Bun docs not found (tried ${tried.join(", ")}): set APHRODY_BUN_CHECKOUT to the oven-sh/bun checkout, ` +
        `APHRODY_BUN_DOCS to a docs directory, or allow the download (unset APHRODY_BUN_DOCS_FETCH=0)`,
    );
  (options.log ?? ((message: string) => console.error(message)))(
    `Bun docs: no oven-sh/bun checkout; downloading docs/ of ${FORK_URL} @ ${ref} into ${cache}`,
  );
  await fetchForkDocs(ref, cache);
  return { dir: cached, source: "download" };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Base revision of a local checkout: `--ref`, else `origin/main` when it exists, else `HEAD`. */
function checkoutBase(checkout: string, ref: string | undefined): string {
  if (ref) return ref;
  const probe = Bun.spawnSync(["git", "-C", checkout, "rev-parse", "--verify", "--quiet", "origin/main"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  return probe.exitCode === 0 ? "origin/main" : "HEAD";
}

export async function runBunUpstreamDocs(args: string[]): Promise<number> {
  let ref: string | undefined;
  let repoRoot = process.cwd();
  let source: string | undefined;
  let check = false;
  let resolveOnly = false;
  let download = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") repoRoot = args[++index] ?? "";
    else if (arg === "--ref") ref = args[++index] ?? "";
    else if (arg === "--source") source = args[++index] ?? "";
    else if (arg === "--check") check = true;
    else if (arg === "--resolve") resolveOnly = true;
    else if (arg === "--no-download") download = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun packages/bun-workspace/src/automation/bun-upstream-docs.ts [--root <repository>] [--source <bun checkout>] [--ref <branch-or-commit>] [--check]\n" +
          "       bun packages/bun-workspace/src/automation/bun-upstream-docs.ts --resolve [--no-download] [--ref <commit>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!repoRoot || ref === "" || source === "") throw new Error("--root, --ref and --source require a value");
  repoRoot = resolve(repoRoot);
  if (resolveOnly) {
    const found = await resolveBunDocs({
      download,
      ref,
      pinFile: join(repoRoot, BUN_PIN_DIR, "SOURCE.json"),
    });
    console.log(`${found.dir}\t${found.source}`);
    return 0;
  }
  const local = localBunCheckout(source);
  let checkout: string;
  let base: string;
  let cleanup: string | undefined;
  if (local) {
    checkout = local;
    base = checkoutBase(local, ref);
  } else {
    const data = bunDataDir() ?? join(homedir(), ".cache", "aphrody", "bun");
    checkout = await fetchForkDocs(ref ?? "main", join(data, "pin"));
    cleanup = checkout;
    base = "HEAD";
  }
  try {
    if (!isDocsSite(join(checkout, "docs")))
      throw new Error(`${checkout}/docs is not the Bun docs site (no docs.json)`);
    const docsPaths = ["--", "docs"];
    const commit = git(checkout, ["log", "-1", "--format=%H", base, ...docsPaths]);
    const date = git(checkout, ["log", "-1", "--format=%cs", base, ...docsPaths]);
    const target = join(repoRoot, BUN_PIN_DIR);
    const files: Record<string, string> = {};
    const contents = new Map<string, Uint8Array>();
    for (const name of ROOT_FILES) {
      const show = Bun.spawnSync(["git", "-C", checkout, "show", `${base}:${name}`], {
        windowsHide: true,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (show.exitCode !== 0) throw new Error(`git show ${base}:${name} failed: ${show.stderr.toString().trim()}`);
      files[name] = sha256(show.stdout);
      contents.set(name, show.stdout);
    }
    const stale = existsSync(target)
      ? (await readdir(target, { recursive: true, withFileTypes: true }))
          .filter(entry => entry.isFile())
          .map(entry =>
            join(entry.parentPath, entry.name)
              .slice(target.length + 1)
              .replaceAll("\\", "/"),
          )
          .filter(rel => !KEEP.has(rel))
          .toSorted()
      : [];
    const changed = (
      await Promise.all(
        Object.entries(files).map(async ([rel, hash]) => {
          const path = join(target, rel);
          const same = existsSync(path) && sha256(await Bun.file(path).bytes()) === hash;
          return same ? undefined : rel;
        }),
      )
    ).filter((rel): rel is string => rel !== undefined);
    const pin: BunDocsPin = {
      source: FORK_SOURCE,
      repository: FORK_URL,
      path: "docs/",
      commit,
      date,
      command: "bun packages/bun-workspace/src/automation/bun-upstream-docs.ts --root .",
      files,
    };
    const pinText = `${JSON.stringify(pin, null, 2)}\n`;
    const pinPath = join(target, "SOURCE.json");
    const pinStale = !existsSync(pinPath) || (await Bun.file(pinPath).text()) !== pinText;
    const summary = `docs/ of ${checkout} @ ${commit.slice(0, 11)} (${date}, ${base}): ${changed.length} changed, ${stale.length} stale`;
    if (check) {
      const ok = changed.length === 0 && stale.length === 0 && !pinStale;
      console.log(`${ok ? "current" : "stale"} ${BUN_PIN_DIR}: ${summary}`);
      return ok ? 0 : 1;
    }
    await Promise.all(changed.map(rel => Bun.write(join(target, rel), contents.get(rel) ?? new Uint8Array())));
    await Bun.write(pinPath, pinText);
    await Promise.all(stale.map(rel => rm(join(target, rel), { force: true })));
    for (const entry of await readdir(target, { withFileTypes: true }))
      if (entry.isDirectory()) await rm(join(target, entry.name), { recursive: true, force: true });
    console.log(`Pinned ${BUN_PIN_DIR}: ${summary}`);
    return 0;
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await runBunUpstreamDocs(process.argv.slice(2)));
