#!/usr/bin/env bun
/**
 * Counts the places where bun-os scripts, CI and tooling depend on a specific POSIX-on-Windows stack
 * (MSYS2, MinGW, Cygwin, GnuWin32, Git Bash). Reproducible proof for docs/POSIX-ON-WINDOWS.md:
 *
 *   bun scripts/posix-deps-audit.ts            # working tree
 *   bun scripts/posix-deps-audit.ts origin/os  # a ref (git grep on that tree)
 *
 * Data files (component manifests, source locks, licence text) and the modules whose job is to manage MSYS2 sources are
 * excluded: they describe the stacks, they do not depend on them to build.
 */
const ref = Bun.argv[2];
const SCOPE = [".github", "scripts", "factory", "packages", "crates", "justfile", "package.json"];
const EXCLUDE = [
  ":!vendor",
  ":!**/node_modules/**",
  ":!factory/msys2",
  ":!factory/arch",
  ":!factory/bunos/components.json",
  ":!factory/usr/overlay",
  ":!packages/package-converter",
  ":!scripts/posix-deps-audit.ts",
  ":!packages/buncc/test",
  ":!packages/windows/src/posix",
  ":!packages/buncc/src/legacy.ts",
  ":!packages/buncc/src/providers/msys2.ts",
  ":!packages/buncc/src/providers/mingw.ts",
  ":!packages/buncc/src/providers/posix.ts",
  ":!packages/buncc/src/providers/wine.ts",
  ":!packages/buncc/src/providers/ensure.ts",
  ":!packages/buncc/src/providers/toolchains.ts",
  ":!packages/buncc/src/posix-cli.ts",
  ":!packages/buncc/src/cli.ts",
  ":!packages/buncc/src/sh.ts",
  ":!packages/buncc/src/profiles.ts",
  ":!**/*.lock",
  ":!**/Cargo.lock",
];

const PATTERNS: Record<string, string> = {
  "msys2 (name or C:\\msys64 path)": "msys2|msys64",
  "hard-coded msys64 drive path": "[A-Za-z]:.{1,2}msys(64|32)",
  "mingw": "mingw",
  "cygwin": "cygwin",
  "gnuwin32": "gnuwin32",
  "CI `shell: bash`": "shell: bash",
};

async function count(pattern: string): Promise<{ lines: number; files: number }> {
  const args = ["grep", "-IiE", "-c", pattern, ...(ref ? [ref] : []), "--", ...SCOPE, ...EXCLUDE];
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  let lines = 0;
  let files = 0;
  for (const row of out.split("\n").filter(Boolean)) {
    const n = Number(row.slice(row.lastIndexOf(":") + 1));
    if (n > 0) {
      lines += n;
      files++;
    }
  }
  return { lines, files };
}

console.log(`posix-deps-audit ${ref ?? "(working tree)"}`);
let total = 0;
for (const [label, pattern] of Object.entries(PATTERNS)) {
  const { lines, files } = await count(pattern);
  total += lines;
  console.log(`${label.padEnd(34)} lines=${String(lines).padStart(3)} files=${files}`);
}
console.log(`${"total".padEnd(34)} lines=${String(total).padStart(3)}`);
