/** Build engine of `buncc desktop`: tools bootstrap, source fetch, meson/cmake build into a shared prefix per target. */
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { cacheDir } from "../lock.ts";
import { run } from "../process.ts";
import { captureVcvars, findVisualStudio } from "../providers/msvc.ts";
import { download, extractArchive } from "../providers/_shared.ts";
import { loadRecipes, type Recipe, type RecipeFile, type Target } from "./recipes.ts";

export interface BuildOptions {
  root: string;
  target: string;
  /** msvc targets: cl (default) or clang-cl. */
  cc: "cl" | "clang-cl";
  jobs: number;
  /** "graph": one install per package into the shared prefix. "mono": the top package pulls every dependency as a meson subproject. */
  mode: "graph" | "mono";
  sccache: boolean;
  dryRun: boolean;
  /** Use the pinned LTS tag when the recipe has one. */
  lts: boolean;
}

export const defaultJobs = () => Math.max(1, cpus().length);

export function workDir(): string {
  return resolve(Bun.env.BUNCC_DESKTOP_DIR ?? join(cacheDir(), "desktop"));
}
export const toolsRoot = () => join(workDir(), "tools");
export const prefixOf = (target: string, tag = "") => join(workDir(), "prefix", target + tag);
const srcOf = (r: Recipe, tag: string) => join(workDir(), "src", `${r.id}-${tag.replace(/[^\w.]/g, "_")}`);
const buildOf = (r: Recipe, target: string, cc: string) => join(workDir(), "build", `${target}-${cc}`, r.id);

export function pinFor(r: Recipe, lts: boolean) {
  return (lts && r.lts) || r.pin;
}

const log = (message: string) => console.log(`desktop: ${message}`);

async function sh(argv: string[], env: Record<string, string | undefined>, cwd?: string): Promise<void> {
  const started = Date.now();
  log(`$ ${argv.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  const result = await run(argv, { env, cwd, output: "inherit", timeoutMs: 6 * 3600_000 });
  if (result.code !== 0) throw new Error(`${argv[0]} exited ${result.code}${result.timedOut ? " (timeout)" : ""}`);
  log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// ---- tools --------------------------------------------------------------------------------------------------------

export function toolBins(): string[] {
  const t = toolsRoot();
  return [join(t, "venv", "Scripts"), join(t, "venv", "bin"), join(t, "pkgconf", "bin"), join(t, "win-flex-bison"), join(t, "gettext", "bin")].filter(existsSync);
}

/** Install the pinned build tools into the desktop work dir (idempotent). Python tools go into a private venv. */
export async function ensureTools(file: RecipeFile, opts: BuildOptions, env: Record<string, string | undefined>): Promise<void> {
  const t = toolsRoot();
  mkdirSync(t, { recursive: true });
  const venv = join(t, "venv");
  const py = process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
  if (!existsSync(py)) {
    const system = Bun.which("python") ?? Bun.which("python3");
    if (!system) throw new Error("python not found: install it with `buncc install uv` or winget Python.Python.3");
    await sh([system, "-m", "venv", venv], env);
  }
  const need: string[] = [];
  for (const name of ["meson", "ninja"] as const) {
    const tool = file.tools[name]!;
    if (!(await probe(venv, name, tool.version!))) need.push(`${tool.name}==${tool.version}`);
  }
  if (need.length) await sh([py, "-m", "pip", "install", "-q", "--disable-pip-version-check", ...need], env);

  for (const [name, tool] of Object.entries(file.tools)) {
    if (tool.source !== "zip") continue;
    const dest = join(t, name);
    if (existsSync(dest)) continue;
    log(`fetch ${name} ${tool.url}`);
    const bytes = await download(tool.url!, tool.sha256!);
    const archive = join(t, `${name}.zip`);
    await Bun.write(archive, bytes);
    await extractArchive(archive, dest);
    rmSync(archive, { force: true });
  }
  const pk = file.tools.pkgconf!;
  const pkDest = join(t, "pkgconf");
  if (!existsSync(join(pkDest, "bin", "pkgconf.exe")) && !existsSync(join(pkDest, "bin", "pkgconf"))) {
    const src = join(t, "src", "pkgconf");
    if (!existsSync(src)) await cloneAt(pk.repo!, pk.tag!, pk.sha!, src, env);
    const env2 = { ...env, PATH: [...toolBins(), env.PATH ?? ""].join(delimiter) };
    const bdir = join(t, "build", "pkgconf");
    await sh([join(venv, process.platform === "win32" ? "Scripts" : "bin", "meson"), "setup", bdir, src, `--prefix=${pkDest}`, "--buildtype=release"], env2);
    await sh([join(venv, process.platform === "win32" ? "Scripts" : "bin", "ninja"), "-C", bdir, "install"], env2);
    // pkg-config is the name that meson looks for first.
    const exe = process.platform === "win32" ? ".exe" : "";
    await Bun.write(join(pkDest, "bin", `pkg-config${exe}`), Bun.file(join(pkDest, "bin", `pkgconf${exe}`)));
  }
  const have = (env.PATH ?? "").split(delimiter);
  const add = toolBins().filter(d => !have.includes(d));
  if (add.length) env.PATH = [...add, env.PATH ?? ""].join(delimiter);
}

async function probe(venv: string, name: string, version: string): Promise<boolean> {
  const bin = join(venv, process.platform === "win32" ? "Scripts" : "bin", name + (process.platform === "win32" ? ".exe" : ""));
  if (!existsSync(bin)) return false;
  const r = await run([bin, "--version"], { output: "capture", timeoutMs: 20_000 });
  return r.code === 0 && r.stdout.trim().startsWith(version.split(".").slice(0, 2).join("."));
}

export async function cloneAt(repo: string, tag: string, sha: string, dest: string, env: Record<string, string | undefined>): Promise<void> {
  if (existsSync(join(dest, ".git"))) {
    const head = await run(["git", "rev-parse", "HEAD"], { cwd: dest, output: "capture" });
    if (head.stdout.trim() === sha || !sha) return;
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(join(dest, ".."), { recursive: true });
  await sh(["git", "clone", "-q", "--depth", "1", "--branch", tag, repo, dest], env);
  const head = await run(["git", "rev-parse", "HEAD"], { cwd: dest, output: "capture" });
  if (sha && head.stdout.trim() !== sha) {
    // A tag that moved or an annotated tag object recorded instead of the commit: the pin is the source of truth.
    const deref = await run(["git", "rev-parse", `${tag}^{commit}`], { cwd: dest, output: "capture" });
    if (deref.stdout.trim() !== sha) throw new Error(`${repo} ${tag}: HEAD ${head.stdout.trim()} != pinned ${sha}`);
  }
}

// ---- environment --------------------------------------------------------------------------------------------------

export function mingwDir(): string | undefined {
  const base = join(cacheDir(), "tools", "llvm-mingw");
  if (!existsSync(base)) return undefined;
  const versions = readdirSync(base).sort();
  const v = versions.at(-1);
  if (!v) return undefined;
  const dir = join(base, v);
  const inner = existsSync(join(dir, "bin")) ? dir : readdirSync(dir).map(n => join(dir, n)).find(p => existsSync(join(p, "bin")));
  return inner;
}

/** Full environment for building `target`: MSVC developer environment (or llvm-mingw), tools, prefix on PATH and PKG_CONFIG_PATH. */
export async function buildEnv(opts: BuildOptions, file: RecipeFile): Promise<Record<string, string>> {
  const target = file.targets[opts.target];
  if (!target) throw new Error(`unknown target ${opts.target}; known: ${Object.keys(file.targets).join(", ")}`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(Bun.env)) if (v !== undefined) env[k] = v;
  const prefix = prefixOf(opts.target);
  if (target.kind === "msvc") {
    const vs = await findVisualStudio(Bun.env);
    if (!vs) throw new Error("Visual Studio Build Tools not found: run `buncc install msvc`");
    const host = process.arch === "arm64" ? "arm64" : "x64";
    const arch = target.arch === host ? host : `${host}_${target.arch}`;
    const { env: vc } = await captureVcvars(vs, { arch }, Bun.env);
    for (const [k, v] of Object.entries(vc)) env[k.toLowerCase() === "path" ? "PATH" : k] = v;
    if (opts.cc === "clang-cl") {
      env.CC = env.CXX = "clang-cl";
      env.PATH = [join(Bun.env.ProgramFiles ?? "C:\\Program Files", "LLVM", "bin"), env.PATH].join(delimiter);
    } else env.CC = env.CXX = "cl";
  } else {
    const mingw = mingwDir();
    if (!mingw) throw new Error("llvm-mingw not installed: run `buncc install mingw --run`");
    env.PATH = [join(mingw, "bin"), env.PATH].join(delimiter);
  }
  const extra = [...toolBins(), join(prefix, "bin")];
  env.PATH = [...extra, env.PATH ?? ""].join(delimiter);
  for (const k of Object.keys(env)) if (k !== "PATH" && k.toLowerCase() === "path") delete env[k];
  env.PKG_CONFIG_PATH = [join(prefix, "lib", "pkgconfig"), join(prefix, "share", "pkgconfig")].join(delimiter);
  env.CMAKE_PREFIX_PATH = prefix;
  env.MESON_PACKAGE_CACHE_DIR = join(workDir(), "packagecache");
  mkdirSync(env.MESON_PACKAGE_CACHE_DIR, { recursive: true });
  if (!opts.sccache) env.BUNCC_SCCACHE = "off";
  return env;
}

function crossFiles(opts: BuildOptions, target: Target): { meson?: string; cmake?: string } {
  if (!target.cross) return {};
  const dir = join(workDir(), "cross");
  mkdirSync(dir, { recursive: true });
  const meson = join(dir, `${opts.target}.meson`);
  const cmake = join(dir, `${opts.target}.cmake`);
  const cpu = (target.triple ?? "").startsWith("aarch64") || target.arch === "arm64" ? "aarch64" : "x86_64";
  if (target.kind === "llvm-mingw") {
    const t = target.triple!;
    writeFileSync(
      meson,
      `[binaries]\nc = '${t}-clang'\ncpp = '${t}-clang++'\nar = 'llvm-ar'\nstrip = 'llvm-strip'\nwindres = '${t}-windres'\npkg-config = 'pkgconf'\n\n[host_machine]\nsystem = 'windows'\ncpu_family = '${cpu}'\ncpu = '${cpu}'\nendian = 'little'\n\n[properties]\nneeds_exe_wrapper = true\n`,
    );
    writeFileSync(
      cmake,
      `set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR ${cpu})\nset(CMAKE_C_COMPILER ${t}-clang)\nset(CMAKE_CXX_COMPILER ${t}-clang++)\nset(CMAKE_RC_COMPILER ${t}-windres)\nset(CMAKE_AR llvm-ar)\nset(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)\n`,
    );
  } else {
    writeFileSync(
      meson,
      `[binaries]\nc = 'cl'\ncpp = 'cl'\nar = 'lib'\nlinker = 'link'\npkg-config = 'pkgconf'\n\n[host_machine]\nsystem = 'windows'\ncpu_family = '${cpu}'\ncpu = '${cpu}'\nendian = 'little'\n\n[properties]\nneeds_exe_wrapper = true\n`,
    );
    writeFileSync(cmake, `set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR ARM64)\nset(CMAKE_C_COMPILER cl)\nset(CMAKE_CXX_COMPILER cl)\n`);
  }
  return { meson, cmake };
}

// ---- build --------------------------------------------------------------------------------------------------------

interface Stamp {
  id: string;
  tag: string;
  sha: string;
  hash: string;
  seconds: number;
  at: string;
}
const stampPath = (prefix: string, id: string) => join(prefix, ".buncc", `${id}.json`);

function optionHash(r: Recipe, opts: BuildOptions, pin: { tag: string; sha: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([r.options, r.build, pin, opts.cc, opts.target, opts.mode]))
    .digest("hex")
    .slice(0, 16);
}

export interface BuildResult {
  id: string;
  skipped: boolean;
  seconds: number;
}

export async function buildPackage(r: Recipe, file: RecipeFile, opts: BuildOptions, env: Record<string, string>, repoRoot: string): Promise<BuildResult> {
  const target = file.targets[opts.target]!;
  const prefix = prefixOf(opts.target);
  const pin = r.local ? { tag: "local", sha: "" } : pinFor(r, opts.lts);
  if (!pin?.tag) throw new Error(`${r.id}: no pin; run \`buncc desktop plan --pin\``);
  if (r.status === "plan-only") throw new Error(`${r.id}: plan-only recipe (${r.note ?? "not buildable on Windows yet"})`);
  const hash = optionHash(r, opts, pin);
  const stamp = stampPath(prefix, r.id);
  if (existsSync(stamp)) {
    const old = JSON.parse(readFileSync(stamp, "utf8")) as Stamp;
    if (old.hash === hash) return { id: r.id, skipped: true, seconds: 0 };
  }
  const started = Date.now();
  const src = r.local ? resolve(repoRoot, r.local) : srcOf(r, pin.tag);
  if (!r.local) await cloneAt(r.repo!, pin.tag, pin.sha, src, env);
  const bdir = buildOf(r, opts.target, opts.cc);
  const cross = crossFiles(opts, target);
  const bin = (n: string) => n;
  if (r.build === "meson") {
    const wrap = opts.mode === "mono" ? "forcefallback" : "default";
    if (!existsSync(join(bdir, "build.ninja"))) {
      const args = ["setup", bdir, src, `--prefix=${prefix}`, "--buildtype=release", `--wrap-mode=${wrap}`, "--libdir=lib", ...r.options];
      if (cross.meson) args.push("--cross-file", cross.meson);
      await sh([bin("meson"), ...args], env);
    }
    await sh([bin("ninja"), "-C", bdir, "-j", String(opts.jobs), "install"], env);
  } else {
    if (!existsSync(join(bdir, "build.ninja"))) {
      const args = ["-G", "Ninja", "-S", src, "-B", bdir, "-DCMAKE_BUILD_TYPE=Release", `-DCMAKE_INSTALL_PREFIX=${prefix}`, `-DCMAKE_PREFIX_PATH=${prefix}`, ...r.options];
      if (opts.sccache && Bun.which("sccache")) args.push("-DCMAKE_C_COMPILER_LAUNCHER=sccache", "-DCMAKE_CXX_COMPILER_LAUNCHER=sccache");
      if (target.kind === "msvc") args.push("-DCMAKE_POLICY_DEFAULT_CMP0141=NEW", "-DCMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded");
      if (opts.cc === "clang-cl" && target.kind === "msvc") args.push("-DCMAKE_C_COMPILER=clang-cl", "-DCMAKE_CXX_COMPILER=clang-cl");
      if (cross.cmake) args.push(`-DCMAKE_TOOLCHAIN_FILE=${cross.cmake}`);
      if (r.group === "kf6" || r.group === "plasma-libs" || r.group === "apps") {
        const ecm = join(prefix, "share", "ECM", "cmake");
        args.push(`-DCMAKE_MODULE_PATH=${ecm}`, `-DECM_DIR=${ecm}`);
      }
      if (!["qtbase"].includes(r.id) && existsSync(join(prefix, "lib", "cmake", "Qt6"))) args.push(`-DQt6_DIR=${join(prefix, "lib", "cmake", "Qt6")}`);
      await sh(["cmake", ...args], env);
    }
    await sh(["cmake", "--build", bdir, "--parallel", String(opts.jobs)], env);
    await sh(["cmake", "--install", bdir], env);
  }
  const seconds = (Date.now() - started) / 1000;
  mkdirSync(join(prefix, ".buncc"), { recursive: true });
  const record: Stamp = { id: r.id, tag: pin.tag, sha: pin.sha, hash, seconds, at: new Date().toISOString() };
  writeFileSync(stamp, JSON.stringify(record, null, 2));
  return { id: r.id, skipped: false, seconds };
}

export function dirStats(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        files++;
        bytes += statSync(p).size;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { files, bytes };
}

export { loadRecipes };
