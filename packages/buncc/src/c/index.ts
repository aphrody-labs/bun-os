/**
 * `buncc c doctor|env|sysroot|targets|build|test` over the catalog factory/c/c-env.json.
 * The catalog is data; this file only turns a target entry into a compiler command line, verifies the produced PE/ELF
 * by parsing its header and runs it where a runner exists. Nothing Microsoft-licensed is fetched without
 * --accept-ms-license or BUNOS_C_ACCEPT_MS_LICENSE=1 (the xwin crate downloads the MSVC CRT and Windows SDK).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

export interface CTarget {
  triple: string;
  os: string;
  abi: string;
  arch: string;
  compiler: string;
  linker: string;
  libc: string;
  headers: string;
  sysroot: string;
  optIn?: string;
  clangTriple?: string;
  extraFlags?: string[];
  runner: Record<string, string>;
  verify: "pe" | "elf";
  status?: string;
  note?: string;
}
export interface CEnv {
  llvm: { version: string };
  headerSources: Record<string, { license: string; open: boolean; optIn?: boolean }>;
  targets: CTarget[];
  tools: Record<string, unknown>;
}

const HERE = import.meta.dir;
export const repoRoot = resolve(HERE, "../../../..");
export const loadCatalog = (): CEnv => JSON.parse(readFileSync(join(repoRoot, "factory/c/c-env.json"), "utf8"));

const isWin = osPlatform() === "win32";
const exe = (n: string) => (isWin ? `${n}.exe` : n);
export const hostKind = () => (isWin ? "windows" : osPlatform() === "linux" ? "linux" : osPlatform());
export const cacheRoot = () =>
  process.env.BUNOS_C_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "bunos-c");

export function msLicenseAccepted(args: string[]): boolean {
  return args.includes("--accept-ms-license") || process.env.BUNOS_C_ACCEPT_MS_LICENSE === "1";
}

function which(name: string, extra: string[] = []): string | undefined {
  const dirs = [...extra, ...(process.env.PATH ?? "").split(delimiter)];
  for (const dir of dirs) {
    if (!dir) continue;
    const p = join(dir, exe(name));
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** llvm-mingw root: $BUNOS_C_LLVM_MINGW, then cache, then PATH (a bin dir holding x86_64-w64-mingw32-clang). */
export function llvmMingwBin(): string | undefined {
  const env = process.env.BUNOS_C_LLVM_MINGW;
  if (env && existsSync(join(env, "bin"))) return join(env, "bin");
  const cached = join(cacheRoot(), "llvm-mingw");
  if (existsSync(cached)) {
    const sub = readdirSync(cached).find(d => d.startsWith("llvm-mingw-"));
    if (sub && existsSync(join(cached, sub, "bin"))) return join(cached, sub, "bin");
  }
  const onPath = which("x86_64-w64-mingw32-clang");
  return onPath ? dirname(onPath) : undefined;
}

export function sysrootFor(t: CTarget): string | undefined {
  const key = `BUNOS_C_SYSROOT_${t.sysroot.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${t.arch.toUpperCase()}`;
  const dir = process.env[key] ?? process.env[`BUNOS_C_SYSROOT_${t.sysroot.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
  if (dir) return dir;
  const cached = join(cacheRoot(), "sysroots", t.sysroot);
  return existsSync(cached) ? cached : undefined;
}

export interface BuildPlan {
  env?: Record<string, string>;
  ok: boolean;
  reason?: string;
  cmd?: string[];
  out: string;
}

export function planBuild(t: CTarget, src: string, outDir: string): BuildPlan {
  const base = src.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const ext = t.os === "linux" || t.os === "bun-os" ? "" : ".exe";
  const out = join(outDir, `${base}-${t.triple}${ext}`);
  const clang = which("clang");
  if (t.abi === "msvc") {
    const clangCl = which("clang-cl");
    if (!clangCl) return { ok: false, reason: "clang-cl not found", out };
    const sys = sysrootFor(t);
    const cmd = [clangCl, `--target=${t.triple}`, "/nologo", "/O2", "/MD", src, `/Fe:${out}`, `/Fo:${out}.obj`];
    if (sys) {
      const a = t.arch === "i686" ? "x86" : t.arch;
      cmd.push(
        `/imsvc${join(sys, "crt/include")}`,
        `/imsvc${join(sys, "sdk/include/ucrt")}`,
        `/imsvc${join(sys, "sdk/include/um")}`,
        `/imsvc${join(sys, "sdk/include/shared")}`,
        "-fuse-ld=lld-link",
        "/link",
        `/libpath:${join(sys, "crt/lib", a)}`,
        `/libpath:${join(sys, "sdk/lib/ucrt", a)}`,
        `/libpath:${join(sys, "sdk/lib/um", a)}`,
      );
    } else {
      if (!(isWin && hostArch() === t.arch))
        return {
          ok: false,
          reason:
            "needs an xwin sysroot (buncc c sysroot --accept-ms-license) or a local Visual Studio of the same arch",
          out,
        };
      return { ok: true, cmd, out, env: vsEnv(t.arch) };
    }
    return { ok: true, cmd, out };
  }
  if (t.sysroot === "llvm-mingw") {
    const bin = llvmMingwBin();
    const cc = bin && join(bin, exe(`${t.clangTriple ?? t.triple}-clang`));
    if (!cc || !existsSync(cc)) return { ok: false, reason: "llvm-mingw not found (BUNOS_C_LLVM_MINGW)", out };
    return { ok: true, cmd: [cc, "-O2", src, ...(t.extraFlags ?? []), "-o", out], out };
  }
  // linux / bun-os / musl
  if (!clang) return { ok: false, reason: "clang not found", out };
  const sys = sysrootFor(t);
  const triple = t.clangTriple ?? t.triple;
  const native = hostKind() === "linux" && hostArch() === t.arch && t.abi === "gnu" && t.os === "linux" && !sys;
  if (!sys && !native)
    return {
      ok: false,
      reason: `needs a ${t.sysroot} sysroot (BUNOS_C_SYSROOT_${t.sysroot.toUpperCase().replace(/[^A-Z0-9]/g, "_")})`,
      out,
    };
  const cmd = [clang, `--target=${triple}`, "-O2", "-fuse-ld=lld", src, "-o", out];
  if (sys) cmd.splice(2, 0, `--sysroot=${sys}`);
  if (t.abi === "musl") cmd.push("-static");
  return { ok: true, cmd, out };
}

/** INCLUDE/LIB/PATH of the user's own Visual Studio (found with vswhere, then vcvarsall); read-only, nothing is installed. */
const vsCache = new Map<string, Record<string, string>>();
import { writeFileSync } from "node:fs";
export function vsEnv(arch: string): Record<string, string> | undefined {
  if (!isWin) return undefined;
  if (vsCache.has(arch)) return vsCache.get(arch);
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio/Installer/vswhere.exe",
  );
  if (!existsSync(vswhere)) return undefined;
  const q = Bun.spawnSync([vswhere, "-latest", "-products", "*", "-property", "installationPath"]);
  const root = q.stdout.toString().trim().split(/\r?\n/)[0];
  const bat = root && join(root, "VC/Auxiliary/Build/vcvarsall.bat");
  if (!bat || !existsSync(bat)) return undefined;
  const tmp = join(process.env.TEMP ?? ".", `bunos-c-vs-${arch}.bat`);
  writeFileSync(
    tmp,
    `@echo off
call "${bat}" ${arch === "x86_64" ? "x64" : arch === "aarch64" ? "arm64" : "x86"} >nul
set
`,
  );
  const r = Bun.spawnSync(["cmd", "/d", "/c", tmp]);
  const env: Record<string, string> = {};
  for (const line of r.stdout.toString().split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  vsCache.set(arch, env);
  return env;
}

export function hostArch(): string {
  return process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
}

// ---- header verification ------------------------------------------------------------------------------------------
const PE_MACHINE: Record<number, string> = { 0x8664: "x86_64", 0xaa64: "aarch64", 0x14c: "i686" };
const ELF_MACHINE: Record<number, string> = { 62: "x86_64", 183: "aarch64", 3: "i686" };

export function inspectBinary(buf: Uint8Array): {
  format: "pe" | "elf" | "unknown";
  arch?: string;
  imports?: string[];
} {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const pe = dv.getUint32(0x3c, true);
    if (dv.getUint32(pe, true) !== 0x00004550) return { format: "unknown" };
    const text = new TextDecoder("latin1").decode(buf);
    const imports = [...new Set((text.match(/[A-Za-z0-9_.-]{3,40}\.dll/gi) ?? []).map(s => s.toLowerCase()))];
    return { format: "pe", arch: PE_MACHINE[dv.getUint16(pe + 4, true)], imports };
  }
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return { format: "elf", arch: ELF_MACHINE[dv.getUint16(18, true)] };
  }
  return { format: "unknown" };
}

// ---- runners ------------------------------------------------------------------------------------------------------
export function pickRunner(t: CTarget, binary: string): { cmd?: string[]; skip?: string } {
  const kind = t.runner[hostKind()];
  const archMatch = hostArch() === t.arch;
  if (kind === "native" && archMatch) return { cmd: [binary] };
  if (t.runner[hostKind()] === "qemu-user") {
    const q = which(`qemu-${t.arch}`) ?? which(`qemu-${t.arch}-static`);
    return q ? { cmd: [q, "-L", sysrootFor(t) ?? "/", binary] } : { skip: `qemu-${t.arch} not installed` };
  }
  if (kind === "wine") {
    const w = which("wine64") ?? which("wine");
    return w ? { cmd: [w, binary] } : { skip: "wine not installed (CI installs it on the runner only)" };
  }
  if (
    isWin &&
    (t.os === "windows" || t.os === "reactos") &&
    (archMatch || (t.arch === "i686" && hostArch() === "x86_64"))
  )
    return { cmd: [binary] };
  if (!isWin && t.os === "windows" && t.arch !== "aarch64") {
    const w = which("wine64") ?? which("wine");
    if (w) return { cmd: [w, binary] };
  }
  return { skip: `no runner for ${t.triple} on ${hostKind()}/${hostArch()}` };
}

async function sh(cmd: string[], opts: { env?: Record<string, string>; timeoutMs?: number } = {}) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...opts.env } });
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 120_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { stdout, stderr, code };
}

async function version(tool: string, args = ["--version"]): Promise<string | undefined> {
  const p = which(tool, tool.includes("mingw") ? [llvmMingwBin() ?? ""] : []);
  if (!p) return undefined;
  try {
    const r = await sh([p, ...args], { timeoutMs: 15_000 });
    return ((r.stdout || r.stderr).split(/\r?\n/)[0] ?? "").trim().slice(0, 100) || "present";
  } catch {
    return "present";
  }
}

// ---- commands -----------------------------------------------------------------------------------------------------
const USAGE = `buncc c: Bun OS C environment (catalog factory/c/c-env.json)
  buncc c targets [--json]
  buncc c doctor
  buncc c env <triple>
  buncc c sysroot <triple> [--accept-ms-license] [--run]   (msvc targets download Microsoft-licensed files: opt-in only)
  buncc c build <triple> <file.c> [--out dir] [--dry]
  buncc c test [--only triple,...] [--out dir]               smoke matrix: build, parse header, run when a runner exists`;

export async function cCommand(argv: string[]): Promise<number> {
  const [sub = "help", ...rest] = argv;
  const cat = loadCatalog();
  const find = (triple?: string) => {
    const t = cat.targets.find(x => x.triple === triple);
    if (!t) throw new Error(`unknown target ${triple}; run: buncc c targets`);
    return t;
  };
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  switch (sub) {
    case "targets": {
      if (rest.includes("--json")) console.log(JSON.stringify(cat.targets, null, 2));
      else
        for (const t of cat.targets)
          console.log(
            `${t.triple.padEnd(28)} ${t.os.padEnd(8)} ${t.compiler.split(" (")[0]!.padEnd(18)} ${t.libc.split(" (")[0]!.padEnd(18)} headers=${t.headers}${t.optIn ? " [opt-in " + t.optIn + "]" : ""}`,
          );
      return 0;
    }
    case "doctor": {
      console.log(`host ${hostKind()}/${hostArch()}  catalog LLVM ${cat.llvm.version}`);
      for (const tool of [
        "clang",
        "clang-cl",
        "lld-link",
        "ld.lld",
        "llvm-ar",
        "llvm-readelf",
        "llvm-objdump",
        "cl",
        "gcc",
        "x86_64-w64-mingw32-clang",
        "cmake",
        "ninja",
        "meson",
        "make",
        "pkgconf",
        "sccache",
        "cargo-xwin",
        "xwin",
        "wine",
        "qemu-x86_64",
        "qemu-aarch64",
      ]) {
        const v = await version(tool, tool === "cl" ? [] : ["--version"]);
        console.log(`${v ? "ok " : "-- "} ${tool.padEnd(26)} ${v ?? "not found"}`);
      }
      console.log(`llvm-mingw bin: ${llvmMingwBin() ?? "not found"}`);
      console.log(
        `Microsoft licence: ${msLicenseAccepted(rest) ? "opt-in given" : "not accepted (msvc sysroots are not downloaded)"}`,
      );
      return 0;
    }
    case "env": {
      const t = find(rest[0]);
      const sys = sysrootFor(t);
      const lines: string[] = [`BUNOS_C_TARGET=${t.triple}`];
      if (t.abi === "msvc")
        lines.push("CC=clang-cl", "CXX=clang-cl", "LD=lld-link", "AR=llvm-lib", `CL_FLAGS=--target=${t.triple}`);
      else if (t.sysroot === "llvm-mingw")
        lines.push(
          `CC=${t.clangTriple ?? t.triple}-clang`,
          `CXX=${t.clangTriple ?? t.triple}-clang++`,
          `AR=llvm-ar`,
          `PATH+=${llvmMingwBin() ?? "<llvm-mingw>/bin"}`,
        );
      else
        lines.push(
          `CC=clang --target=${t.clangTriple ?? t.triple}${sys ? ` --sysroot=${sys}` : ""} -fuse-ld=lld`,
          "AR=llvm-ar",
        );
      if (sys) lines.push(`SYSROOT=${sys}`);
      console.log(lines.join("\n"));
      return 0;
    }
    case "sysroot": {
      const t = find(rest[0]);
      if (t.abi !== "msvc") {
        console.log(
          `${t.triple}: sysroot "${t.sysroot}" is fully open (${t.headers}); provide it with BUNOS_C_SYSROOT_* or the bunos-c package. Nothing to download here.`,
        );
        return 0;
      }
      if (!msLicenseAccepted(rest)) {
        console.error(
          `${t.triple}: the xwin sysroot downloads the MSVC CRT and Windows SDK under Microsoft's licence terms.\n` +
            `Only the owner can accept them. Re-run with --accept-ms-license (or BUNOS_C_ACCEPT_MS_LICENSE=1) after reading the terms.\n` +
            `Open alternatives: x86_64-w64-mingw32 / aarch64-w64-mingw32 (mingw-w64 headers), *-reactos (ReactOS PSDK).`,
        );
        return 2;
      }
      const out = flag("out") ?? join(cacheRoot(), "sysroots", "xwin");
      const cmd = [
        "xwin",
        "--accept-license",
        "--cache-dir",
        join(cacheRoot(), "xwin-cache"),
        "splat",
        "--output",
        out,
        "--arch",
        "x86_64,aarch64,x86",
      ];
      console.log(cmd.join(" "));
      if (!rest.includes("--run")) return (console.log("dry run; add --run to execute"), 0);
      mkdirSync(out, { recursive: true });
      return (await Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" }).exited) as number;
    }
    case "build": {
      const t = find(rest[0]);
      const src = rest[1];
      if (!src) throw new Error("usage: buncc c build <triple> <file.c>");
      const outDir = resolve(flag("out") ?? "build-c");
      mkdirSync(outDir, { recursive: true });
      const plan = planBuild(t, src, outDir);
      if (!plan.ok) return (console.error(`${t.triple}: ${plan.reason}`), 3);
      console.log(plan.cmd!.join(" "));
      if (rest.includes("--dry")) return 0;
      const r = await sh(plan.cmd!, { env: plan.env });
      if (r.code) console.error(r.stderr || r.stdout);
      return r.code;
    }
    case "test": {
      const only = flag("only")?.split(",");
      const outDir = resolve(flag("out") ?? "build-c");
      mkdirSync(outDir, { recursive: true });
      const src = join(repoRoot, "factory/c/smoke/hello.c");
      const rows: Array<Record<string, string>> = [];
      let failed = 0;
      for (const t of cat.targets) {
        if (only && !only.includes(t.triple)) continue;
        const row: Record<string, string> = { target: t.triple };
        const plan = planBuild(t, src, outDir);
        if (!plan.ok) {
          row.build = `skipped: ${plan.reason}`;
          rows.push(row);
          continue;
        }
        const r = await sh(plan.cmd!, { env: plan.env });
        if (r.code || !existsSync(plan.out)) {
          row.build = "FAIL";
          row.detail = (r.stderr || r.stdout).split("\n").slice(0, 3).join(" | ");
          failed++;
          rows.push(row);
          continue;
        }
        row.build = "ok";
        const info = inspectBinary(new Uint8Array(readFileSync(plan.out)));
        row.header = `${info.format}/${info.arch}`;
        if (info.format !== t.verify || info.arch !== t.arch) {
          row.header += " MISMATCH";
          failed++;
        }
        if (info.imports?.length) row.imports = info.imports.filter(i => /crt|msvcrt|ucrt|kernel32/.test(i)).join(",");
        const run = pickRunner(t, plan.out);
        if (run.cmd) {
          const rr = await sh(run.cmd, { timeoutMs: 60_000 });
          const ok = rr.code === 0 && rr.stdout.includes("bunos-c hello");
          row.run = ok ? "ok" : `FAIL(${rr.code})`;
          if (!ok) failed++;
        } else row.run = `skipped: ${run.skip}`;
        rows.push(row);
      }
      for (const row of rows) console.log(JSON.stringify(row));
      return failed ? 1 : 0;
    }
    default:
      console.log(USAGE);
      return sub === "help" ? 0 : 1;
  }
}

if (import.meta.main) process.exit(await cCommand(process.argv.slice(2)));
