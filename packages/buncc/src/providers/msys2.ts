/**
 * msys2: detect an existing MSYS2 (read-only) and optionally provision a pinned, managed copy under the buncc cache.
 *
 * Decision (docs/POSIX-ON-WINDOWS.md): scripts do not need the MSYS2 runtime any more (provider `posix`), and compilers do
 * not either (provider `mingw`). What MSYS2 still has that nothing else has is its package repositories. The ucrt64,
 * clang64 and clangarm64 repositories are plain Windows binaries; the managed copy uses MSYS2's own pinned pacman to
 * install them into the buncc-owned tree, never into a system one. The existing machine install is never touched here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { download, extractArchive, missing, pathVar, prependPath, toolsDir } from "./_shared.ts";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Context, Detection, Provider } from "./types.ts";

/** msys2/msys2-installer release 2026-09-27; sha256 is the digest GitHub publishes for the asset. */
export const MSYS2_BASE = {
  release: "2026-09-27",
  name: "msys2-base-x86_64-20260927.tar.xz",
  url: "https://github.com/msys2/msys2-installer/releases/download/2026-09-27/msys2-base-x86_64-20260927.tar.xz",
  sha256: "ea2f31a0b6ade63914ce441ffb022f0f6aa96982bfefa2326460a26d5fb01322",
};

/** Repositories whose packages are native Windows binaries (no msys-2.0.dll needed). Mirror: mirror.msys2.org. */
export const MSYS2_NATIVE_REPOS = {
  ucrt64: { triple: "x86_64-w64-mingw32", prefix: "mingw-w64-ucrt-x86_64-" },
  clang64: { triple: "x86_64-w64-mingw32", prefix: "mingw-w64-clang-x86_64-" },
  clangarm64: { triple: "aarch64-w64-mingw32", prefix: "mingw-w64-clang-aarch64-" },
} as const;
export type Msys2Repo = keyof typeof MSYS2_NATIVE_REPOS;

/** Candidate roots of an existing MSYS2 install, most specific first. Pure. */
export function msys2Candidates(env: Record<string, string | undefined>): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const list = [
    env.MSYS2_ROOT,
    "C:\\msys64",
    join(home, "scoop", "apps", "msys2", "current"),
    "C:\\tools\\msys64",
    join(env.ChocolateyInstall ?? "C:\\ProgramData\\chocolatey", "lib", "msys2", "tools", "msys64"),
  ];
  return [...new Set(list.filter((p): p is string => !!p))];
}

export function isMsys2Root(root: string, exists: (p: string) => boolean = existsSync): boolean {
  return exists(join(root, "usr", "bin", "msys-2.0.dll")) || exists(join(root, "usr", "bin", "pacman.exe"));
}

export function findMsys2(
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  return msys2Candidates(env).find(root => isMsys2Root(root, exists));
}

export function managedRoot(): string {
  return join(toolsDir("msys2"), MSYS2_BASE.release, "msys64");
}

/** Plan to run MSYS2's pacman for native packages in a managed root. Commands only; nothing runs. */
export function msys2InstallPlan(root: string, repo: Msys2Repo, packages: string[]): string[][] {
  const meta = MSYS2_NATIVE_REPOS[repo];
  const names = packages.map(p => (p.startsWith("mingw-w64-") ? p : meta.prefix + p));
  const bash = join(root, "usr", "bin", "bash.exe");
  return [
    [bash, "-lc", "exit"],
    [join(root, "usr", "bin", "pacman.exe"), "-Syu", "--noconfirm", "--disable-download-timeout"],
    [join(root, "usr", "bin", "pacman.exe"), "-S", "--needed", "--noconfirm", ...names],
  ];
}

/** Download the pinned base archive (checksum verified) and unpack it atomically. Needs network; Windows only. */
export async function ensureMsys2(options: { fetcher?: typeof fetch } = {}): Promise<string> {
  const root = managedRoot();
  if (isMsys2Root(root)) return root;
  const bytes = await download(MSYS2_BASE.url, MSYS2_BASE.sha256, "sha256", options.fetcher);
  const work = `${root}.partial-${process.pid}`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const archive = join(work, MSYS2_BASE.name);
  writeFileSync(archive, bytes);
  await extractArchive(archive, join(work, "x"));
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, ".."), { recursive: true });
  renameSync(join(work, "x", "msys64"), root);
  rmSync(work, { recursive: true, force: true });
  return root;
}

export const msys2Provider: Provider = {
  id: "msys2",
  description: "MSYS2: existing install detected read-only, optional pinned managed copy (package repositories only)",
  platforms: ["win32"],
  async detect(ctx: Context): Promise<Detection> {
    const managed = isMsys2Root(managedRoot()) ? managedRoot() : undefined;
    const existing = findMsys2(ctx.env);
    const root = managed ?? existing;
    if (!root)
      return missing(
        "not required: use `buncc env posix` and `buncc env mingw`; `buncc env msys2 --ensure` for a managed copy",
      );
    return {
      found: true,
      path: root,
      notes: [managed ? `managed copy ${MSYS2_BASE.release}` : "existing install, read-only (never modified by buncc)"],
    };
  },
  install: () => ({ commands: [["buncc", "env", "msys2", "--ensure"]] }),
  async env(ctx): Promise<Record<string, string>> {
    const root = isMsys2Root(managedRoot()) ? managedRoot() : undefined;
    // An existing install is deliberately NOT put on PATH: that is what made builds depend on it.
    return root ? { PATH: prependPath(pathVar(ctx), [join(root, "usr", "bin")]), MSYS2_ROOT: root } : {};
  },
};
