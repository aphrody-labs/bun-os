#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0 AND MIT
/**
 * Generate test/fixtures/upstream-golden.json: the JSON output of upstream's own Python search.py
 * (nextlevelbuilder/ui-ux-pro-max-skill at the pinned upstream commit) over this package's catalogs,
 * for a fixed set of queries. test/upstream-golden.test.ts asserts that the Bun port reproduces it.
 *
 * Python is used only here, to produce the fixture: the upstream scripts are read from the vendored
 * fork's git history into a scratch directory next to a copy of intelligence/ui-ux-pro-max/data and
 * run with `uv run --no-project python -I`. Run it after a sync that changes data or the engine:
 *
 *   bun run golden:upstream
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, PACKAGE_DIR, VENDOR_DIR, readPin } from "./sync-upstream.ts";

export const GOLDEN_FILE = join(PACKAGE_DIR, "test", "fixtures", "upstream-golden.json");
const UPSTREAM_SCRIPTS = ["core.py", "design_system.py", "reasoning_contract.py", "search.py"];

/** The fixed query set: every upstream domain, auto-detection, a spread of stacks, RTL and -n limits. */
export const GOLDEN_QUERIES: string[][] = [
  ["glassmorphism", "--domain", "style"],
  ["minimalism dark mode", "--domain", "style"],
  ["dashboard", "--domain", "style", "-n", "5"],
  ["brutalism bold", "--domain", "style"],
  ["fintech crypto", "--domain", "color"],
  ["healthcare calm", "--domain", "color"],
  ["dashboard trend over time", "--domain", "chart"],
  ["hero social proof pricing", "--domain", "landing"],
  ["saas", "--domain", "product"],
  ["beauty spa wellness", "--domain", "product"],
  ["error summary validation", "--domain", "ux"],
  ["orphan heading line balance", "--domain", "ux"],
  ["focus ring keyboard", "--domain", "ux", "-n", "5"],
  ["elegant serif", "--domain", "typography"],
  ["variable sans serif", "--domain", "google-fonts"],
  ["decorative icon aria hidden", "--domain", "icons"],
  ["scroll reveal stagger", "--domain", "gsap"],
  ["rerender memo list", "--domain", "react"],
  ["accessibilityLabel touch safe-areas", "--domain", "web"],
  ["dashboard", "--domain", "style", "--rtl=full"],
  ["saas", "--domain", "product", "--rtl=full", "-n", "1"],
  ["mobile", "--domain", "style", "--rtl", "-n", "10"],
  ["fintech", "--domain", "product", "--rtl=caveats"],
  ["neumorphism"],
  ["serif font pairing"],
  ["pie chart comparison"],
  ["form validation", "--stack", "react"],
  ["streaming suspense", "--stack", "nextjs"],
  ["responsive layout", "--stack", "html-tailwind"],
  ["chip badge overflow nowrap", "--stack", "html-tailwind"],
  ["tailwind 2xl breakpoint", "--stack", "html-tailwind"],
  ["react 3d canvas effect cleanup", "--stack", "react"],
  ["virtualized list", "--stack", "react-native"],
  ["state management", "--stack", "flutter"],
  ["navigation stack", "--stack", "swiftui"],
  ["dialog form", "--stack", "shadcn"],
  ["composition api", "--stack", "vue"],
  ["runes", "--stack", "svelte"],
  ["content collections", "--stack", "astro"],
  ["UTable columns", "--stack", "nuxt-ui"],
  ["tableview binding", "--stack", "javafx"],
  ["mvvm binding", "--stack", "wpf"],
  ["OrbitControls", "--stack", "threejs"],
];

/** sha256 of every catalog file Python reads (rows outside the upstream config are ignored by Python). */
export async function dataFingerprint(dataDir = DATA_DIR): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const files = [...new Bun.Glob("**/*.{csv,json}").scanSync({ cwd: dataDir })]
    .map(p => p.replaceAll("\\", "/"))
    .sort();
  for (const rel of files) {
    hasher.update(`${rel}\0`);
    hasher.update(await Bun.file(join(dataDir, rel)).bytes());
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

async function upstreamScript(commit: string, name: string): Promise<string> {
  const show = (rev: string) =>
    Bun.spawnSync(["git", "-C", VENDOR_DIR, "show", `${rev}:src/ui-ux-pro-max/scripts/${name}`], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
  let proc = show(commit);
  if (proc.exitCode !== 0) {
    Bun.spawnSync(
      ["git", "-C", VENDOR_DIR, "fetch", "-q", "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git", commit],
      {
        windowsHide: true,
      },
    );
    proc = show(commit);
  }
  if (proc.exitCode !== 0) throw new Error(`cannot read ${name} at upstream ${commit}: ${proc.stderr.toString()}`);
  return proc.stdout.toString();
}

async function main(): Promise<number> {
  const pin = await readPin();
  const scratch = join(PACKAGE_DIR, ".golden-tmp");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  try {
    for (const name of UPSTREAM_SCRIPTS)
      await Bun.write(join(scratch, "scripts", name), await upstreamScript(pin.upstreamCommit, name));
    cpSync(DATA_DIR, join(scratch, "data"), { recursive: true });
    const search = join(scratch, "scripts", "search.py");
    const cases = [];
    for (const args of GOLDEN_QUERIES) {
      const proc = Bun.spawnSync(["uv", "run", "--no-project", "--quiet", "python", "-I", search, ...args, "--json"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        windowsHide: true,
      });
      if (proc.exitCode !== 0) throw new Error(`search.py ${args.join(" ")}: ${proc.stderr.toString()}`);
      cases.push({ args, result: JSON.parse(proc.stdout.toString()) });
    }
    const fixture = {
      upstreamCommit: pin.upstreamCommit,
      generator: "uv run --no-project python -I src/ui-ux-pro-max/scripts/search.py <args> --json",
      dataFingerprint: await dataFingerprint(),
      cases,
    };
    await Bun.write(GOLDEN_FILE, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`Wrote ${cases.length} upstream Python results to ${GOLDEN_FILE}.`);
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main());
