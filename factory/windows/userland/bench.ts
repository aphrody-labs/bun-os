#!/usr/bin/env bun
/**
 * Benchmarks the installed Bun OS userland against the Git for Windows GNU tools (MSYS2 runtime) with hyperfine
 * (no shell, output discarded, warmup 2). Prints one Markdown table (mean ± σ, ratio GNU/ours).
 *
 *   bun factory/windows/userland/bench.ts [--link-dir C:\Windows\System32] [--gnu "C:\Program Files\Git\usr\bin"]
 *
 * Input: a generated 2,000,000-line (56 MB) text file and the vendor/nushell source tree.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = Bun.argv.slice(2);
const option = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const sys = process.env.SystemRoot ?? "C:\\Windows";
const linkDir = option("--link-dir", join(sys, "System32"));
const gnu = option("--gnu", "C:\\Program Files\\Git\\usr\\bin");
const hyperfine = join(linkDir, "hyperfine.exe");
const root = resolve(import.meta.dir, "../../..");
const tree = join(root, "vendor", "nushell");
const work = join(tmpdir(), "bunos-userland-bench");
mkdirSync(work, { recursive: true });
const big = join(work, "big.txt");
if (!existsSync(big)) {
  const lines: string[] = [];
  let s = 1;
  for (let i = 0; i < 2_000_000; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    lines.push(`${s.toString(36)} alpha beta ${i % 997} gamma`);
  }
  writeFileSync(big, lines.join("\n") + "\n");
}
const q = (p: string) => `"${p}"`;
const g = (n: string) => q(join(gnu, `${n}.exe`));
const u = (n: string) => q(join(linkDir, `${n}.exe`));
const cases: [string, string, string][] = [
  ["sort 56 MB", `${g("sort")} ${q(big)}`, `${u("usort")} ${q(big)}`],
  ["wc -l 56 MB", `${g("wc")} -l ${q(big)}`, `${u("wc")} -l ${q(big)}`],
  ["sha256sum 56 MB", `${g("sha256sum")} ${q(big)}`, `${u("sha256sum")} ${q(big)}`],
  ["grep -c gamma (uutils grep)", `${g("grep")} -c gamma ${q(big)}`, `${u("grep")} -c gamma ${q(big)}`],
  ["grep -c gamma (ripgrep)", `${g("grep")} -c gamma ${q(big)}`, `${u("rg")} -c gamma ${q(big)}`],
  ["sed s/alpha/omega/g 56 MB", `${g("sed")} s/alpha/omega/g ${q(big)}`, `${u("sed")} s/alpha/omega/g ${q(big)}`],
  ["cut -d' ' -f2", `${g("cut")} -d " " -f2 ${q(big)}`, `${u("cut")} -d " " -f2 ${q(big)}`],
  ["find tree -name *.rs (uutils find)", `${g("find")} ${q(tree)} -name *.rs`, `${u("ufind")} ${q(tree)} -name *.rs`],
  ["find tree -name *.rs (fd)", `${g("find")} ${q(tree)} -name *.rs`, `${u("fd")} -u -e rs . ${q(tree)}`],
  ["ls -laR tree", `${g("ls")} -laR ${q(tree)}`, `${u("ls")} -laR ${q(tree)}`],
  ["grep -r fn tree (ripgrep)", `${g("grep")} -r -c fn ${q(tree)}`, `${u("rg")} -uuu -c fn ${q(tree)}`],
  ["shell startup: -c true", `${g("bash")} -c true`, `${u("brush")} -c true`],
  ["shell loop 20k iterations", `${g("bash")} -c "for ((i=0;i<20000;i++)); do x=$((i*2)); done"`, `${u("brush")} -c "for ((i=0;i<20000;i++)); do x=$((i*2)); done"`],
];
const rows = ["| Case | GNU (Git for Windows) | Bun OS userland | GNU / ours |", "| --- | --- | --- | --- |"];
for (const [label, a, b] of cases) {
  const out = join(work, "h.json");
  const p = Bun.spawnSync([hyperfine, "-N", "--warmup", "2", "--min-runs", "5", "--output", "null", "--export-json", out, a, b], { stdout: "ignore", stderr: "pipe" });
  if (p.exitCode !== 0) {
    rows.push(`| ${label} | failed | failed | ${p.stderr.toString().trim().split("\n").pop()} |`);
    continue;
  }
  const [ra, rb] = JSON.parse(readFileSync(out, "utf8")).results;
  const ms = (r: { mean: number; stddev: number }) => `${(r.mean * 1000).toFixed(1)} ± ${(r.stddev * 1000).toFixed(1)} ms`;
  rows.push(`| ${label} | ${ms(ra)} | ${ms(rb)} | ${(ra.mean / rb.mean).toFixed(2)}x |`);
  console.error(rows.at(-1));
}
console.log(rows.join("\n"));
