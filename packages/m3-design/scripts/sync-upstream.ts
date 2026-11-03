#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0 AND MIT
/**
 * Sync the ui-ux-pro-max catalogs of @aphrody/m3-design from the vendored aphrody-labs fork.
 *
 * Upstream nextlevelbuilder/ui-ux-pro-max-skill (MIT) is vendored as the aphrody-labs fork at
 * vendor/ui-ux-pro-max-skill (a submodule on the fork's main). The fork keeps upstream data,
 * merged with git, and its Bun commands (`bun run bunify:catalogs`). This script rebuilds
 * intelligence/ui-ux-pro-max/data from it:
 *
 *   1. every file of the fork's `.claude/skills/ui-ux-pro-max/data`, byte for byte, except the
 *      files Bun OS owns (brands.csv, catalog-summary.json, stacks/m3.csv) and the retired
 *      rg-ui stack;
 *   2. the first-party stacks of intelligence/ui-ux-pro-max/local/stacks (m3, iced-libcosmic, egui);
 *   3. brands.csv generated from the canonical token owner (scripts/brands.ts);
 *   4. catalog-summary.json recomputed with the fork's own generator;
 *   5. LICENSE (upstream MIT) and upstream.json (fork and upstream pins).
 *
 * The search engine (scripts/*.ts), SKILL.md and references stay owned here; the report lists the
 * fork changes to them since the previous pin so they can be ported by hand.
 *
 *   bun run sync:upstream             # write, then print the report
 *   bun run sync:upstream -- --check  # exit 1 when data/ differs from a fresh sync
 *   bun run sync:upstream -- --golden # also regenerate the upstream Python golden (uv)
 *
 * Update the fork first: merge upstream main into aphrody-labs/ui-ux-pro-max-skill, push, then
 * `git -C vendor/ui-ux-pro-max-skill pull` and run this script.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { parseCsvRecords } from "../intelligence/ui-ux-pro-max/scripts/csv.ts";
import { generateBrandsCsv, REPO_ROOT } from "./brands.ts";

export const PACKAGE_DIR = join(import.meta.dir, "..");
export const OWNER_DIR = join(PACKAGE_DIR, "intelligence", "ui-ux-pro-max");
export const DATA_DIR = join(OWNER_DIR, "data");
export const LOCAL_DIR = join(OWNER_DIR, "local");
export const PIN_FILE = join(OWNER_DIR, "upstream.json");
export const VENDOR_DIR = join(REPO_ROOT, "vendor", "ui-ux-pro-max-skill");
export const FORK_SKILL = ".claude/skills/ui-ux-pro-max";
export const FORK_DATA = join(VENDOR_DIR, ...FORK_SKILL.split("/"), "data");

/** Fork data files Bun OS replaces or drops (Bun OS has one theme: Material 3). */
export const OWNED_FILES = new Set(["brands.csv", "catalog-summary.json", "stacks/m3.csv"]);
export const DROPPED_FILES = new Set(["stacks/rg-ui.csv"]);

export interface Pin {
  fork: string;
  forkCommit: string;
  upstream: string;
  upstreamCommit: string;
  path: string;
}

const posix = (path: string) => path.replaceAll("\\", "/");

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, base));
    else out.push(posix(relative(base, path)));
  }
  return out.sort();
}

function git(args: string[], cwd = VENDOR_DIR): string | null {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
}

export function vendorAvailable(): boolean {
  return existsSync(join(VENDOR_DIR, ".git")) && existsSync(FORK_DATA);
}

export async function readPin(): Promise<Pin> {
  return (await Bun.file(PIN_FILE).json()) as Pin;
}

/** The fork HEAD and the newest upstream commit it contains (the newest commit not authored by aphrody-dev). */
async function currentPin(previous: Pin | null): Promise<Pin> {
  const forkCommit = git(["rev-parse", "HEAD"]);
  if (!forkCommit)
    throw new Error(`${VENDOR_DIR} is not a git checkout; run git submodule update --init vendor/ui-ux-pro-max-skill`);
  const upstreamCommit =
    git(["log", "-1", "--format=%H", "--perl-regexp", "--author=^(?!aphrody-dev)", "HEAD"]) ?? previous?.upstreamCommit;
  if (!upstreamCommit) throw new Error("cannot find the upstream commit in the fork history (shallow clone?)");
  return {
    fork: "https://github.com/aphrody-labs/ui-ux-pro-max-skill",
    forkCommit,
    upstream: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    upstreamCommit,
    path: FORK_SKILL,
  };
}

/** The complete generated data/ tree (relative path -> bytes) plus LICENSE and upstream.json. */
export async function buildTree(pin: Pin): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const rel of walk(FORK_DATA)) {
    if (OWNED_FILES.has(rel) || DROPPED_FILES.has(rel)) continue;
    files.set(`data/${rel}`, await Bun.file(join(FORK_DATA, rel)).bytes());
  }
  for (const rel of walk(join(LOCAL_DIR, "stacks"))) {
    files.set(`data/stacks/${rel}`, await Bun.file(join(LOCAL_DIR, "stacks", rel)).bytes());
  }
  files.set("data/brands.csv", new TextEncoder().encode(await generateBrandsCsv()));
  files.set("data/catalog-summary.json", new TextEncoder().encode(await catalogSummary(files)));
  files.set("LICENSE", await Bun.file(join(VENDOR_DIR, "LICENSE")).bytes());
  files.set("upstream.json", new TextEncoder().encode(`${JSON.stringify(pin, null, 2)}\n`));
  return files;
}

/** catalog-summary.json computed by the fork's generator over the assembled tree. */
async function catalogSummary(files: Map<string, Uint8Array>): Promise<string> {
  const { build } = await import("../../../vendor/ui-ux-pro-max-skill/scripts/generate-catalog-summary.ts");
  const forkSummary = (await Bun.file(join(FORK_DATA, "catalog-summary.json")).json()) as { verifiedAt: string };
  const scratch = join(PACKAGE_DIR, ".sync-tmp", crypto.randomUUID());
  try {
    for (const [path, bytes] of files) if (path.startsWith("data/")) await Bun.write(join(scratch, path), bytes);
    return `${JSON.stringify(await build(forkSummary.verifiedAt, join(scratch, "data")), null, 2)}\n`;
  } finally {
    rmSync(join(PACKAGE_DIR, ".sync-tmp"), { recursive: true, force: true });
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Paths whose committed bytes differ from the tree, plus data/ files the tree no longer has. */
export async function staleFiles(tree: Map<string, Uint8Array>): Promise<string[]> {
  const stale: string[] = [];
  for (const [path, bytes] of tree) {
    const file = Bun.file(join(OWNER_DIR, path));
    if (!(await file.exists()) || !sameBytes(await file.bytes(), bytes)) stale.push(path);
  }
  for (const rel of walk(DATA_DIR)) if (!tree.has(`data/${rel}`)) stale.push(`data/${rel} (not in the fork)`);
  return stale;
}

function rowCount(bytes: Uint8Array | undefined): number {
  return bytes ? parseCsvRecords(new TextDecoder().decode(bytes)).length : 0;
}

/** Per-catalog row counts before -> after. */
async function countReport(tree: Map<string, Uint8Array>): Promise<string[]> {
  const lines: string[] = [];
  const names = new Set([...walk(DATA_DIR).map(rel => `data/${rel}`), ...tree.keys()]);
  for (const path of [...names].filter(name => name.endsWith(".csv")).sort()) {
    const file = Bun.file(join(OWNER_DIR, path));
    const before = (await file.exists()) ? rowCount(await file.bytes()) : 0;
    const after = rowCount(tree.get(path));
    if (before !== after) lines.push(`  ${path}: ${before} -> ${after} rows`);
  }
  return lines;
}

/** Fork changes to files Bun OS ports by hand (engine, SKILL.md, references) since the previous pin. */
function portReport(previous: Pin | null, pin: Pin): string[] {
  if (!previous || previous.forkCommit === pin.forkCommit) return [];
  const stat = git([
    "diff",
    "--stat",
    `${previous.forkCommit}..${pin.forkCommit}`,
    "--",
    `${FORK_SKILL}/SKILL.md`,
    `${FORK_SKILL}/scripts`,
    `${FORK_SKILL}/references`,
    "cli/templates/base",
  ]);
  if (stat === null)
    return [`  (history ${previous.forkCommit.slice(0, 12)}..${pin.forkCommit.slice(0, 12)} not available)`];
  return stat ? stat.split("\n").map(line => `  ${line}`) : [];
}

/** Regenerate test/fixtures/upstream-golden.json from upstream's Python through uv. */
async function regenerateGolden(): Promise<void> {
  const golden = Bun.spawnSync([process.execPath, join(import.meta.dir, "upstream-golden.ts")], {
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  });
  if (golden.exitCode !== 0) throw new Error("upstream-golden.ts failed");
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { check: { type: "boolean" }, golden: { type: "boolean" } },
  });
  if (!vendorAvailable()) {
    console.error(
      `sync-upstream: ${VENDOR_DIR} is not checked out (git submodule update --init vendor/ui-ux-pro-max-skill)`,
    );
    return 2;
  }
  const previous = existsSync(PIN_FILE) ? await readPin() : null;
  const pin = await currentPin(previous);
  const tree = await buildTree(pin);
  const stale = await staleFiles(tree);

  if (values.check) {
    if (stale.length) {
      console.error(
        `ui-ux-pro-max data is stale against the fork (run bun run sync:upstream):\n  ${stale.join("\n  ")}`,
      );
      return 1;
    }
    console.log(`ui-ux-pro-max data matches aphrody-labs/ui-ux-pro-max-skill ${pin.forkCommit.slice(0, 12)}.`);
    return 0;
  }

  const counts = await countReport(tree);
  for (const [path, bytes] of tree) {
    const target = join(OWNER_DIR, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, bytes);
  }
  for (const rel of walk(DATA_DIR)) if (!tree.has(`data/${rel}`)) rmSync(join(DATA_DIR, rel));
  if (values.golden) await regenerateGolden();

  console.log(
    `Synced from aphrody-labs/ui-ux-pro-max-skill ${pin.forkCommit.slice(0, 12)} (upstream ${pin.upstreamCommit.slice(0, 12)}).`,
  );
  console.log(stale.length ? `Changed: ${stale.join(", ")}` : "No data changes.");
  if (counts.length) console.log(`Rows:\n${counts.join("\n")}`);
  const port = portReport(previous, pin);
  if (port.length) console.log(`Port by hand (engine, SKILL.md, references, base template):\n${port.join("\n")}`);
  console.log("Next: bun run build:skill, then bun test.");
  return 0;
}

if (import.meta.main) process.exit(await main());
