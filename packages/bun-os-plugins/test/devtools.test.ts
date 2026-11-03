// SPDX-License-Identifier: MIT
// `bunos rename|docs|parse|bench` (fork `bun rename|docs|parse|bench`) on upstream Bun, through the real bins.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = (name: string) => join(import.meta.dir, "..", "src", "bin", `bunos-${name}.ts`);

function run(name: string, args: string[], cwd: string) {
  const proc = Bun.spawnSync([process.execPath, bin(name), ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bunos-devtools-"));
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "t@t"],
    ["config", "user.name", "t"],
  ])
    expect(Bun.spawnSync(["git", ...args], { cwd: dir }).exitCode).toBe(0);
  return dir;
}

describe("bunos rename", () => {
  test("dry-run, --apply with a journal, then --restore", () => {
    const dir = gitRepo();
    writeFileSync(join(dir, "a.ts"), 'import x from "@old/pkg";\nconst oldName = "@old/";\n');
    writeFileSync(join(dir, "b.txt"), "keep @older/thing\n");

    const dry = run("rename", ["--from", "@old/", "--to", "@new/", "--json"], dir);
    expect(dry.code).toBe(0);
    const report = JSON.parse(dry.out);
    expect(report.schema).toBe("bun.rename/1");
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toContain("@old/pkg");

    expect(run("rename", ["--from", "@old/", "--to", "@new/", "--apply"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe('import x from "@new/pkg";\nconst oldName = "@new/";\n');
    expect(readFileSync(join(dir, "b.txt"), "utf8")).toBe("keep @older/thing\n");

    const journalDir = join(dir, ".cache", "bun-rename");
    const [journal] = readdirSync(journalDir);
    expect(journal).toMatch(/^rename-.*\.jsonl$/);
    expect(run("rename", ["--restore", join(journalDir, journal!), "--apply"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toContain("@old/pkg");
  });

  test("usage errors exit 1 with a message", () => {
    const result = run("rename", ["--from", "x"], gitRepo());
    expect(result.code).toBe(1);
    expect(result.err).toContain("Each --from needs a --to");
  });
});

test("bunos parse reports imports and exports through Bun.Transpiler", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunos-parse-"));
  writeFileSync(
    join(dir, "m.ts"),
    'import { join } from "node:path";\nexport const a = join("x");\nexport default 1;\n',
  );
  const result = run("parse", ["m.ts", "--json"], dir);
  expect(result.code).toBe(0);
  const json = JSON.stringify(JSON.parse(result.out));
  expect(json).toContain("node:path");
  expect(json).toContain('"a"');
});

test("bunos bench runs the micro-benchmarks", () => {
  const result = run("bench", ["--iterations", "50", "--json"], tmpdir());
  expect(result.code).toBe(0);
  const report = JSON.parse(result.out);
  expect(report.bun).toBe(Bun.version);
  expect(JSON.stringify(report)).toContain("Bun.stripANSI");
});

test("bunos docs searches a local Mintlify docs tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunos-docs-"));
  mkdirSync(join(dir, "docs", "runtime"), { recursive: true });
  writeFileSync(join(dir, "docs", "docs.json"), "{}");
  writeFileSync(join(dir, "docs", "runtime", "ffi.mdx"), "---\ntitle: FFI\ndescription: Call native code\n---\nbody");
  writeFileSync(join(dir, "docs", "runtime", "shell.mdx"), "---\ntitle: Shell\n---\n");
  const result = run("docs", ["ffi", "--json"], dir);
  expect(result.code).toBe(0);
  expect(result.out).toContain("runtime/ffi.mdx");
  expect(result.out).not.toContain("shell.mdx");
});
