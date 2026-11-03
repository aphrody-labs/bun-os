#!/usr/bin/env bun
/**
 * Verifies an installed (or staged) Bun OS Windows userland: every linked command answers --version (or --help),
 * then real work: ls, cp -r, find, sed -i, diff, sort, rg, fd, ouch round trip, and a bash-compatible script with
 * functions, pipes, arrays and [[ ]] run by brush.
 *
 *   bun factory/windows/userland/verify.ts [--link-dir C:\Windows\System32] [--root C:\Windows\BunOS\userland]
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Bun.argv.slice(2);
const option = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const sysRoot = process.env.SystemRoot ?? "C:\\Windows";
const linkDir = option("--link-dir", join(sysRoot, "System32"));
const root = option("--root", join(sysRoot, "BunOS", "userland"));
const record = JSON.parse(readFileSync(join(root, "install-record.json"), "utf8"));
const exe = (name: string) => join(linkDir, `${name}.exe`);
let failed = 0;

function run(cmd: string[], opts: { cwd?: string; stdin?: string } = {}) {
  const p = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    stdin: opts.stdin ? Buffer.from(opts.stdin) : "ignore",
    env: { ...process.env, PATH: `${linkDir};${process.env.PATH}` },
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
};

// 1. Every command linked by the installer starts.
const noVersion = new Set(["[", "test", "true", "false", "yes", "xhs"]);
for (const c of record.commands as { command: string; invoke: string }[]) {
  const [first, ...rest] = c.invoke.split(" ");
  const bin = first.endsWith(".exe") ? join(linkDir, first) : join(root, "bin", `${first}.exe`);
  if (noVersion.has(c.command)) continue;
  let r = run([bin, ...rest, "--version"]);
  if (r.code !== 0) r = run([bin, ...rest, "--help"]);
  check(
    `${c.invoke} --version`,
    r.code === 0,
    r.code === 0 ? (r.out.split("\n")[0] ?? "").trim().slice(0, 70) : r.err.trim().slice(0, 120),
  );
}

// 2. Real work in a scratch directory.
const t = mkdtempSync(join(tmpdir(), "bunos-userland-"));
try {
  run([exe("mkdir"), "-p", "a/b/c"], { cwd: t });
  writeFileSync(join(t, "a/b/c/x.txt"), "hello world\nfoo bar\n");
  writeFileSync(join(t, "a/y.txt"), "zeta\nalpha\nmid\n");
  let r = run([exe("cp"), "-r", "a", "copy"], { cwd: t });
  check("cp -r", r.code === 0 && readFileSync(join(t, "copy/b/c/x.txt"), "utf8").startsWith("hello"));
  r = run([exe("ls"), "-la", "copy/b/c"], { cwd: t });
  check("ls -la", r.code === 0 && r.out.includes("x.txt"));
  r = run(
    [
      join(linkDir, `${record.commands.find((c: any) => c.command === "find").invoke.split(".exe")[0]}.exe`),
      "copy",
      "-name",
      "*.txt",
      "-type",
      "f",
    ],
    { cwd: t },
  );
  check(
    "find -name -type f",
    r.code === 0 && r.out.includes("x.txt") && r.out.includes("y.txt"),
    r.out.trim().replace(/\s+/g, " "),
  );
  r = run([exe("sed"), "-i", "s/world/bun-os/", "copy/b/c/x.txt"], { cwd: t });
  check("sed -i", r.code === 0 && readFileSync(join(t, "copy/b/c/x.txt"), "utf8").includes("hello bun-os"));
  r = run([exe("diff"), "-u", "a/b/c/x.txt", "copy/b/c/x.txt"], { cwd: t });
  check("diff -u", r.code === 1 && r.out.includes("+hello bun-os"));
  const sortName = record.commands.find((c: any) => c.command === "sort").invoke.split(".exe")[0];
  r = run([exe(sortName), "a/y.txt"], { cwd: t });
  check(`${sortName} (GNU sort)`, r.out === "alpha\nmid\nzeta\n");
  r = run([exe("rg"), "-n", "foo", "copy"], { cwd: t });
  check("rg", r.code === 0 && r.out.includes("foo bar"));
  r = run([exe("fd"), "-e", "txt", ".", "copy"], { cwd: t });
  check("fd", r.code === 0 && r.out.split("\n").filter(Boolean).length === 2);
  r = run([exe("ouch"), "compress", "copy", "copy.tar.zst", "-y"], { cwd: t });
  const r2 = run([exe("ouch"), "decompress", "copy.tar.zst", "--dir", "out", "-y"], { cwd: t });
  check(
    "ouch tar.zst round trip",
    r.code === 0 && r2.code === 0 && run([exe("diff"), "-r", "copy", "out/copy"], { cwd: t }).code === 0,
    (r.err + r2.err).trim().slice(0, 120),
  );
  r = run([exe("grep"), "-c", "a", "a/y.txt"], { cwd: t });
  check("grep -c", r.out.trim() === "3");
  r = run([exe("wc"), "-l"], { cwd: t, stdin: "1\n2\n3\n" });
  check("wc -l (stdin)", r.out.trim() === "3");
  r = run([exe("nu"), "-c", "ls copy | length"], { cwd: t });
  check("nu -c", r.code === 0 && r.out.trim() === "2", r.out.trim() + r.err.trim().slice(0, 80));
  writeFileSync(
    join(t, "script.sh"),
    [
      "set -euo pipefail",
      "count_txt() { local d=$1; find \"$d\" -name '*.txt' | wc -l; }",
      "declare -a names=(zeta alpha mid)",
      "sorted=$(printf '%s\\n' \"${names[@]}\" | sort | tr '\\n' ' ')",
      "n=$(count_txt copy)",
      'if [[ $n -eq 2 && $sorted == \'alpha mid zeta \' ]]; then echo "ok n=$n ${#names[@]} items"; else echo "bad n=$n sorted=$sorted"; exit 3; fi',
      "for i in {1..3}; do echo line$i; done | grep -c line",
      "case $n in 2) echo two ;; *) echo other ;; esac",
    ].join("\n") + "\n",
  );
  // The script uses POSIX names; run it with the userland first on PATH, as a POSIX session would.
  const posix = join(t, "posix-bin");
  run([exe("mkdir"), posix]);
  for (const [n, cmd] of [
    ["find", "find"],
    ["sort", "sort"],
  ] as const) {
    const c = record.commands.find((c: any) => c.command === cmd).invoke.split(".exe")[0];
    run([exe("cp"), exe(c), join(posix, `${n}.exe`)]);
  }
  const p = Bun.spawnSync([exe("brush"), "script.sh"], {
    cwd: t,
    env: { ...process.env, PATH: `${posix};${linkDir};${process.env.PATH}` },
  });
  const out = p.stdout.toString();
  check(
    "brush: functions, arrays, pipes, [[ ]], brace expansion, case",
    p.exitCode === 0 && out.includes("ok n=2 3 items") && out.includes("\n3\n") && out.includes("two"),
    (out + p.stderr.toString()).trim().replace(/\s+/g, " ").slice(0, 160),
  );
} finally {
  rmSync(t, { recursive: true, force: true });
}
console.log(failed ? `${failed} checks failed` : "all checks passed");
process.exit(failed ? 1 : 0);
