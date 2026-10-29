#!/usr/bin/env bun
/**
 * Compile-time and size benchmark of one generated C project across compilers (x86_64 Windows PE, -O2, serial, cold).
 *   bun factory/c/bench/bench.ts [--files 120] [--runs 3] [--out dir]
 * Compilers that are not installed are reported as "not measured", never estimated. The project is deterministic.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { llvmMingwBin, vsEnv } from "../../../packages/buncc/src/c/index.ts";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const FILES = Number(arg("files", "120"));
const RUNS = Number(arg("runs", "3"));
const out = resolve(arg("out", "build-c/bench"));

function genProject(dir: string) {
  mkdirSync(dir, { recursive: true });
  const decls: string[] = [];
  for (let f = 0; f < FILES; f++) {
    let s = `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\n#include <stdint.h>\n#include "api.h"\n`;
    for (let k = 0; k < 40; k++) {
      const name = `f${f}_${k}`;
      decls.push(`uint64_t ${name}(uint64_t x);`);
      s += `uint64_t ${name}(uint64_t x) {\n  uint64_t a = x * ${f * 40 + k + 3}u, b = ${k + 1}u;\n  for (int i = 0; i < ${(k % 7) + 3}; i++) {\n    a ^= (a << 13) + b; a ^= a >> 7; b += (uint64_t)sqrt((double)(a & 0xffff)) + strlen("${name}");\n    if (a % 5 == 0) b *= 3; else if (a % 3 == 0) b ^= a;\n  }\n  return a + b;\n}\n`;
    }
    writeFileSync(join(dir, `m${f}.c`), s);
  }
  writeFileSync(join(dir, "api.h"), `#include <stdint.h>\n${decls.join("\n")}\n`);
  let main = `#include <stdio.h>\n#include "api.h"\nint main(void) {\n  uint64_t t = 1;\n`;
  for (let f = 0; f < FILES; f++) main += `  t += f${f}_0(t) + f${f}_39(t);\n`;
  main += `  printf("%llu\\n", (unsigned long long)t);\n  return 0;\n}\n`;
  writeFileSync(join(dir, "main.c"), main);
}

type Cfg = { name: string; env?: Record<string, string>; cc: (src: string, obj: string) => string[]; link: (objs: string[], exe: string) => string[] };
const cfgs: Cfg[] = [];
const vs = vsEnv("x86_64");
if (vs) {
  cfgs.push({ name: "msvc cl 19.51", env: vs, cc: (s, o) => ["cl", "/nologo", "/O2", "/MD", "/c", s, `/Fo${o}`], link: (os, e) => ["link", "/nologo", ...os, `/OUT:${e}`] });
  cfgs.push({ name: "clang-cl 23.1.4 (local VS SDK)", env: vs, cc: (s, o) => ["clang-cl", "/nologo", "/O2", "/MD", "-c", s, `/Fo${o}`], link: (os, e) => ["lld-link", "/nologo", ...os, `/OUT:${e}`] });
}
const mingw = llvmMingwBin();
if (mingw) cfgs.push({ name: "llvm-mingw clang 23.1.4 ucrt x86_64", cc: (s, o) => [join(mingw, process.platform === "win32" ? "x86_64-w64-mingw32-clang.exe" : "x86_64-w64-mingw32-clang"), "-O2", "-c", s, "-o", o], link: (os, e) => [join(mingw, process.platform === "win32" ? "x86_64-w64-mingw32-clang.exe" : "x86_64-w64-mingw32-clang"), ...os, "-o", e] });
const gcc = Bun.which("x86_64-w64-mingw32-gcc");
if (gcc) cfgs.push({ name: "mingw-w64 gcc", cc: (s, o) => [gcc, "-O2", "-c", s, "-o", o], link: (os, e) => [gcc, ...os, "-o", e] });
// Native Linux hosts (CI): gcc and clang against the system glibc.
if (process.platform === "linux") {
  for (const c of ["gcc", "clang"]) {
    const p = Bun.which(c);
    if (p) cfgs.push({ name: `${c} (linux glibc)`, cc: (s, o) => [p, "-O2", "-c", s, "-o", o], link: (os, e) => [p, ...os, "-o", e, "-lm"] });
  }
}

async function exec(cmd: string[], env: Record<string, string> | undefined, cwd: string) {
  const p = Bun.spawn(cmd, { cwd, env: env ?? process.env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [o, e, c] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (c) throw new Error(`${cmd[0]} failed: ${(e || o).slice(0, 300)}`);
}

rmSync(out, { recursive: true, force: true });
const src = join(out, "src");
genProject(src);
const sources = Array.from({ length: FILES }, (_, i) => `m${i}.c`).concat("main.c");
const results: unknown[] = [];
for (const cfg of cfgs) {
  const times: number[] = [];
  let size = 0;
  for (let r = 0; r < RUNS; r++) {
    const wd = join(out, `${cfg.name.replace(/\W+/g, "_")}-${r}`);
    mkdirSync(wd, { recursive: true });
    const t0 = performance.now();
    const objs: string[] = [];
    for (const f of sources) {
      const obj = join(wd, f.replace(/\.c$/, ".obj"));
      objs.push(obj);
      await exec(cfg.cc(join(src, f), obj), cfg.env, src);
    }
    const exe = join(wd, process.platform === "win32" ? "bench.exe" : "bench");
    await exec(cfg.link(objs, exe), cfg.env, src);
    times.push(performance.now() - t0);
    if (existsSync(exe)) size = statSync(exe).size;
  }
  times.sort((a, b) => a - b);
  results.push({ compiler: cfg.name, files: sources.length, runs: RUNS, medianMs: Math.round(times[Math.floor(times.length / 2)]!), minMs: Math.round(times[0]!), exeBytes: size });
}
for (const r of results) console.log(JSON.stringify(r));
if (!results.length) console.log("no compiler found");
const wanted = ["msvc cl", "clang-cl", "llvm-mingw", "mingw-w64 gcc"];
for (const w of wanted) if (!cfgs.some(c => c.name.startsWith(w))) console.log(JSON.stringify({ compiler: w, measured: false, reason: "not installed on this host" }));
