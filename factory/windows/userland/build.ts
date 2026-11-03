#!/usr/bin/env bun
/**
 * Bun OS Windows userland: cross-compiles the Rust Unix toolset listed in tools.json for x86_64-pc-windows-msvc with
 * cargo-xwin on the build host, optimised for the workstation CPU, statically linked against the MSVC CRT (no VC++
 * runtime needed), and collects everything into one directory with a manifest (receipt) and a tarball.
 *
 *   systemd-run --user --scope --slice=build.slice bun factory/windows/userland/build.ts [--only a,b] [--keep-going]
 *
 * The script re-executes itself inside build.slice when it is not already there, waits for memory before each tool
 * (USERLAND_MIN_FREE_GIB, default 10) and builds one tool at a time; Cargo runs through the build-lane wrapper
 * (scripts/aphrody/build/rust/cargo-serial.sh) with the shared sccache. Env overrides: USERLAND_OUT (output root,
 * default $HOME/build/out/windows-userland), USERLAND_TARGET_ROOT (per-tool target dirs, default
 * $HOME/build/cargo/windows-userland), USERLAND_TARGET_CPU (default from tools.json; use x86-64-v3 for a portable build).
 * Docs: docs/WINDOWS-USERLAND.md.
 */
import { $ } from "bun";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join, relative, resolve } from "node:path";

type Bin = { file: string; commands: string[] | "uutils-map" };
type Tool = {
  name: string;
  path: string;
  license: string;
  cargo: string[];
  bins: Bin[];
  panic?: "abort" | "unwind";
  lto?: string;
  optional?: boolean;
  locked?: boolean;
  env?: Record<string, string>;
  share?: { from: string; to: string; exclude?: string[] }[];
};
type Config = {
  target: string;
  targetCpu: string;
  targetCpuSource: string;
  profile: Record<string, string>;
  rustflags: string[];
  tools: Tool[];
};

const here = import.meta.dir;
const root = resolve(here, "../../..");
const config: Config = JSON.parse(readFileSync(join(here, "tools.json"), "utf8"));
const args = Bun.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = option("--only")?.split(",");
const keepGoing = flag("--keep-going");
const env = process.env;
const home = homedir();
const targetCpu = env.USERLAND_TARGET_CPU ?? config.targetCpu;
const minFreeGib = Number(env.USERLAND_MIN_FREE_GIB ?? 10);
const outRoot = resolve(env.USERLAND_OUT ?? join(home, "build/out/windows-userland"));
const targetRoot = resolve(env.USERLAND_TARGET_ROOT ?? join(home, "build/cargo/windows-userland"));

// Run inside build.slice so production (interactive.slice) keeps its memory and CPU share.
const cgroup = existsSync("/proc/self/cgroup") ? readFileSync("/proc/self/cgroup", "utf8") : "";
if (process.platform === "linux" && !cgroup.includes("build.slice") && env.USERLAND_NO_SLICE !== "1") {
  const p = Bun.spawn(
    ["systemd-run", "--user", "--scope", "--quiet", "--slice=build.slice", process.execPath, ...Bun.argv.slice(1)],
    { stdio: ["inherit", "inherit", "inherit"] },
  );
  process.exit(await p.exited);
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const memAvailableGib = () => {
  const m = /MemAvailable:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"));
  return m ? Number(m[1]) / 1024 / 1024 : Infinity;
};
async function waitForMemory(tool: string) {
  for (let i = 0; memAvailableGib() < minFreeGib; i++) {
    if (i === 0) console.log(`[${tool}] waiting for ${minFreeGib} GiB available (now ${memAvailableGib().toFixed(1)})`);
    if (i > 240) throw new Error(`[${tool}] memory stayed below ${minFreeGib} GiB for 2 hours`);
    await Bun.sleep(30_000);
  }
}
const git = async (dir: string, ...a: string[]) => (await $`git -C ${dir} ${a}`.quiet().nothrow().text()).trim();
const cargoField = (dir: string, field: string) => {
  const toml = existsSync(join(dir, "Cargo.toml")) ? readFileSync(join(dir, "Cargo.toml"), "utf8") : "";
  const pkg = toml.split(/^\[package\]/m)[1]?.split(/^\[/m)[0] ?? "";
  return new RegExp(`^${field}\\s*=\\s*"([^"]+)"`, "m").exec(pkg)?.[1];
};

// clang-cl shim: cargo-xwin owns CC/CFLAGS, so C dependencies get the CPU tuning through a PATH wrapper that prepends
// the flags (cc puts the sources after `--`, so appended flags would be taken as files). -mssse3/-msse4.1/-mpclmul are
// implied by the target CPU and keep libwebp-style SIMD sources building.
const shimDir = join(outRoot, ".shim");
mkdirSync(shimDir, { recursive: true });
const realClangCl = Bun.which("clang-cl", { PATH: (env.PATH ?? "").split(":").filter((d) => d !== shimDir).join(":") }) ?? "";
if (!realClangCl) throw new Error("clang-cl not found on PATH");
const cflags = targetCpu === "native" ? [] : [`/clang:-march=${targetCpu}`];
writeFileSync(join(shimDir, "clang-cl"), `#!/bin/sh\nexec ${realClangCl} ${cflags.join(" ")} "$@"\n`, { mode: 0o755 });

const rustc = (await $`rustc -V`.text()).trim();
const xwin = (await $`cargo xwin --version`.quiet().nothrow().text()).trim();
const repoRev = await git(root, "rev-parse", "HEAD");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z");
const outDir = join(outRoot, `userland-${stamp}-${repoRev.slice(0, 10)}`);
const binDir = join(outDir, "bin");
mkdirSync(binDir, { recursive: true });

type Entry = {
  name: string;
  path: string;
  version?: string;
  license: string;
  origin: string;
  upstream?: string;
  commit: string;
  describe: string;
  profile: Record<string, string>;
  files: { path: string; sha256: string; size: number }[];
  commands: { name: string; file: string }[];
  seconds: number;
};
const sources = JSON.parse(readFileSync(join(root, "vendor/sources.json"), "utf8")).sources as Record<
  string,
  { origin: string; upstream?: string; path: string }
>;
const entries: Entry[] = [];
const failures: { name: string; optional: boolean; log: string }[] = [];

for (const tool of config.tools) {
  if (only && !only.includes(tool.name)) continue;
  const dir = join(root, tool.path);
  if (!existsSync(join(dir, "Cargo.toml"))) {
    failures.push({ name: tool.name, optional: !!tool.optional, log: `${tool.path} is not initialised` });
    continue;
  }
  await waitForMemory(tool.name);
  const profile = { ...config.profile, ...(tool.panic && { panic: tool.panic }), ...(tool.lto && { lto: tool.lto }) };
  const toolEnv: Record<string, string> = {
    ...(env as Record<string, string>),
    ...tool.env,
    APHRODY_BUILD_HOST: env.APHRODY_BUILD_HOST ?? "vps",
    APHRODY_CARGO_TARGET_DIR: join(targetRoot, tool.name),
    PATH: `${shimDir}:${env.PATH}`,
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: [`-Ctarget-cpu=${targetCpu}`, ...config.rustflags].join(" "),
  };
  for (const [k, v] of Object.entries(profile)) toolEnv[`CARGO_PROFILE_RELEASE_${k.toUpperCase().replace(/-/g, "_")}`] = v;
  const cmd = [
    "bash",
    join(root, "scripts/aphrody/build/rust/cargo-serial.sh"),
    "xwin",
    "build",
    "--release",
    ...(tool.locked === false ? [] : ["--locked"]),
    "--target",
    config.target,
    ...tool.cargo,
  ];
  console.log(`[${tool.name}] ${relative(root, dir)}: ${cmd.slice(2).join(" ")}`);
  const started = performance.now();
  const logFile = join(outDir, "logs", `${tool.name}.log`);
  mkdirSync(join(outDir, "logs"), { recursive: true });
  const p = Bun.spawn(cmd, { cwd: dir, env: toolEnv, stdout: "pipe", stderr: "pipe" });
  const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  writeFileSync(logFile, o + e);
  const seconds = Math.round((performance.now() - started) / 1000);
  if (code !== 0) {
    console.log(`[${tool.name}] FAILED after ${seconds}s (log ${logFile})\n${(o + e).split("\n").slice(-25).join("\n")}`);
    failures.push({ name: tool.name, optional: !!tool.optional, log: relative(outDir, logFile) });
    if (!keepGoing && !tool.optional) break;
    continue;
  }
  const release = join(targetRoot, tool.name, config.target, "release");
  const entry: Entry = {
    name: tool.name,
    path: tool.path,
    version: cargoField(dir, "version"),
    license: cargoField(dir, "license") ?? tool.license,
    origin: sources[basename(tool.path)]?.origin ?? (await git(dir, "remote", "get-url", "origin")),
    upstream: sources[basename(tool.path)]?.upstream,
    commit: await git(dir, "rev-parse", "HEAD"),
    describe: await git(dir, "describe", "--tags", "--always"),
    profile,
    files: [],
    commands: [],
    seconds,
  };
  for (const bin of tool.bins) {
    const src = join(release, `${bin.file}.exe`);
    const dst = join(binDir, `${bin.file}.exe`);
    cpSync(src, dst);
    entry.files.push({ path: `bin/${bin.file}.exe`, sha256: sha256(dst), size: statSync(dst).size });
    let names = bin.commands;
    if (names === "uutils-map") {
      // Applet list generated by coreutils' build.rs for exactly the features built.
      const buildDir = join(release, "build");
      const map = readdirSync(buildDir)
        .filter((d) => d.startsWith("coreutils-"))
        .map((d) => join(buildDir, d, "out/uutils_map.rs"))
        .filter(existsSync)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (!map) throw new Error("uutils_map.rs not found");
      names = [bin.file, ...[...readFileSync(map, "utf8").matchAll(/\("([^"]+)",\s*\(/g)].map((m) => m[1])];
    }
    for (const name of new Set(names)) entry.commands.push({ name, file: `bin/${bin.file}.exe` });
  }
  // Licence and notice files of the fork, kept with the binaries.
  const licDir = join(outDir, "licenses", tool.name);
  mkdirSync(licDir, { recursive: true });
  for (const f of readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)/i.test(f))) {
    if (statSync(join(dir, f)).isFile()) {
      cpSync(join(dir, f), join(licDir, f));
      entry.files.push({ path: `licenses/${tool.name}/${f}`, sha256: sha256(join(licDir, f)), size: statSync(join(licDir, f)).size });
    }
  }
  for (const share of tool.share ?? []) {
    const from = join(dir, share.from);
    const to = join(outDir, share.to);
    cpSync(from, to, {
      recursive: true,
      filter: (s) => !(share.exclude ?? []).some((x) => relative(from, s).split("/")[0] === x),
    });
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(to)) entry.files.push({ path: relative(outDir, f), sha256: sha256(f), size: statSync(f).size });
  }
  entries.push(entry);
  console.log(`[${tool.name}] ok in ${seconds}s: ${entry.commands.length} commands, ${entry.files.length} files`);
}

const manifest = {
  schema: 1,
  kind: "bunos-windows-userland",
  built: new Date().toISOString(),
  host: hostname(),
  repository: { revision: repoRev, dirty: (await git(root, "status", "--porcelain", "--", "factory/windows/userland")) !== "" },
  target: config.target,
  targetCpu,
  targetCpuSource: config.targetCpuSource,
  rustflags: [`-Ctarget-cpu=${targetCpu}`, ...config.rustflags],
  cflags,
  toolchain: { rustc, cargoXwin: xwin, clangCl: (await $`${realClangCl} --version`.text()).split("\n")[0] },
  tools: entries,
  failures,
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const tarball = `${outDir}.tar.gz`;
await $`tar -C ${outRoot} --exclude=logs -czf ${tarball} ${basename(outDir)}`;
writeFileSync(`${tarball}.sha256`, `${sha256(tarball)}  ${basename(tarball)}\n`);
rmSync(join(outRoot, "latest"), { force: true });
await $`ln -s ${basename(outDir)} ${join(outRoot, "latest")}`;
console.log(`manifest ${join(outDir, "manifest.json")}\ntarball ${tarball} (${(statSync(tarball).size / 1048576).toFixed(1)} MiB)`);
console.log(`built ${entries.length}, failed ${failures.map((f) => f.name + (f.optional ? " (optional)" : "")).join(", ") || "none"}`);
process.exit(failures.some((f) => !f.optional) ? 1 : 0);
