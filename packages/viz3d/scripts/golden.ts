#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Record what upstream's Python helpers print on fixed inputs, once, as the golden fixture of the Bun port:
//
//   bun scripts/golden.ts            # needs uv and the vendor/3dviz-pro-max checkout
//
// Each case runs `uv run --no-project --python 3.12 python <skill>/scripts/<script>.py ...` in the pinned fork and
// stores the parsed JSON in test/fixtures/golden.json; test/golden.test.ts replays the cases through the Bun port.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PACKAGE = resolve(import.meta.dir, "..");
const FORK = resolve(PACKAGE, "../../vendor/3dviz-pro-max");
const SKILL = join(FORK, "skills/3dviz-pro-max");
const FIXTURES = join(PACKAGE, "test/fixtures");

export const SEARCH_CASES: string[][] = [
  ["timber cottage at dusk"],
  ["nostalgic warm unhurried", "--kind", "lighting-profile", "--collection", "knowledge"],
  ["double pendulum chaos", "--limit", "10"],
  ["heart anatomy cutaway", "--collection", "recipes", "--limit", "8"],
  ["foam packaging drop test", "--algorithm", "overlap", "--limit", "6"],
  ["Rubik's cube 3×3 solver", "--limit", "7"],
  ["knowledge.blueprint-timber-cottage"],
  ["hand painted village", "--kind", "style-profile", "--collection", "knowledge", "--limit", "4"],
  ["eigenvectors of a shear matrix", "--direction", "linear-algebra", "--limit", "5"],
  ["contact impulse", "--collection", "knowledge", "--exclude-id", "knowledge.rigid-contact-impulse"],
  ["zzzz qqqq"],
  ["lantern", "--collection", "knowledge", "--kind", "blueprint", "--limit", "20"],
];

export const RESOLVE_CASES: string[][] = [
  ["knowledge.blueprint-timber-cottage"],
  ["recipe.fantasy-village-diorama", "knowledge.framed-shelter", "--related"],
  ["knowledge.blueprint-iron-lantern", "knowledge.lighting-mood-dusk-golden-hour"],
];

export const CONTEXT_CASES: string[][] = [
  ["fantasy village", "--kind", "style-profile", "--kind", "object-archetype"],
  ["medieval market square at night", "--blueprints", "--look", "knowledge.style-hand-painted"],
  [
    "riverside mill hamlet",
    "--blueprints",
    "--host",
    "{HOST_T3}",
    "--delivery",
    "web-desktop",
    "--hero",
    "knowledge.blueprint-watermill",
    "--hero",
    "knowledge.blueprint-timber-cottage",
  ],
  ["riverside mill hamlet", "--blueprints", "--host", "{HOST_T2}", "--delivery", "web-mobile"],
  ["guildhall courtyard", "--blueprints", "--host", "{HOST_T2}", "--delivery", "offline-still", "--hero", "knowledge.blueprint-stone-guildhall"],
];

/** hero-tier with a host file that has no Blender: upstream reports unavailable after computing the cache key. */
export const HERO_CASES: string[][] = [
  ["--record", "knowledge.blueprint-timber-cottage"],
  ["--record", "knowledge.blueprint-watermill", "--params", '{"seed":3,"width":5.0}', "--ao-strength", "1", "--bake-size", "512"],
  ["--record", "knowledge.blueprint-iron-lantern", "--bevel", "0.02"],
];

export const HOSTS = {
  HOST_T3: { quality_ceiling: "T3", quality_ceiling_reason: "Blender 5.2.1 >= 4.2 found", capture_mode_expected: "gpu" },
  HOST_T2: {
    quality_ceiling: "T2",
    quality_ceiling_reason: "no runnable Blender",
    capture_mode_expected: "swiftshader",
    blender: { found: false, path: null, version: null },
  },
};

if (import.meta.main) {
  mkdirSync(FIXTURES, { recursive: true });
  for (const [name, host] of Object.entries(HOSTS)) writeFileSync(join(FIXTURES, `${name}.json`), JSON.stringify(host));
  const run = (script: string, args: string[]) => {
    const filled = args.map(a => a.replace(/^\{(HOST_T[23])\}$/, (_, h: string) => join(FIXTURES, `${h}.json`)));
    const proc = Bun.spawnSync(["uv", "run", "--no-project", "--python", "3.12", "python", join(SKILL, "scripts", script), ...filled], {
      cwd: SKILL,
      env: { ...process.env, PYTHONHASHSEED: "0", PYTHONIOENCODING: "utf-8" },
    });
    if (proc.exitCode !== 0) throw new Error(`${script} ${args.join(" ")}: ${proc.stderr.toString()}`);
    return JSON.parse(proc.stdout.toString());
  };
  const golden = {
    commit: Bun.spawnSync(["git", "-C", FORK, "rev-parse", "HEAD"]).stdout.toString().trim(),
    python: Bun.spawnSync(["uv", "run", "--no-project", "--python", "3.12", "python", "--version"]).stdout.toString().trim(),
    search: SEARCH_CASES.map(args => ({ args, output: run("search.py", args) })),
    resolve: RESOLVE_CASES.map(args => ({ args, output: run("resolve.py", args) })),
    context: CONTEXT_CASES.map(args => ({ args, output: run("design-context.py", args) })),
    hero: HERO_CASES.map(args => ({
      args,
      output: run("hero-tier.py", [...args, "--out", join(FORK, ".cache/hero-tier/golden.glb"), "--host", "{HOST_T2}"]),
    })),
  };
  writeFileSync(join(FIXTURES, "golden.json"), `${JSON.stringify(golden, null, 1)}\n`);
  console.log(`golden: ${golden.search.length} search, ${golden.resolve.length} resolve, ${golden.context.length} context cases`);
}
