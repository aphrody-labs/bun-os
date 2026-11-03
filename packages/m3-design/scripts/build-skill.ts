#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0 AND MIT
/**
 * Build the distributable ui-ux-pro-max skill directory from its owner, intelligence/ui-ux-pro-max:
 * SKILL.md (with the Bun OS Material 3 contract), LICENSE (upstream MIT), UPSTREAM.md, upstream.json,
 * data/, references/ and the Bun scripts. The output, packages/m3-design/skill/ui-ux-pro-max, is
 * generated and committed so it can be packaged as a Claude Code or Codex plugin; never edit it.
 *
 *   bun run build:skill              # write skill/ui-ux-pro-max
 *   bun run build:skill -- --check   # exit 1 when the committed copy is stale
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { OWNER_DIR, PACKAGE_DIR } from "./sync-upstream.ts";

export const SKILL_OUT = join(PACKAGE_DIR, "skill", "ui-ux-pro-max");
const INCLUDE = ["SKILL.md", "LICENSE", "UPSTREAM.md", "upstream.json", "data", "references", "scripts"];
const EXCLUDE = /(^|\/)(tests?\/|[^/]*\.test\.ts$)/;

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, base));
    else out.push(relative(base, path).replaceAll("\\", "/"));
  }
  return out;
}

export function skillFiles(): string[] {
  const files: string[] = [];
  for (const entry of INCLUDE) {
    const path = join(OWNER_DIR, entry);
    if (!existsSync(path)) throw new Error(`${path} is missing`);
    if (statSync(path).isDirectory()) files.push(...walk(path, OWNER_DIR));
    else files.push(entry);
  }
  return files.filter(file => !EXCLUDE.test(file)).sort();
}

export async function staleSkillFiles(): Promise<string[]> {
  const stale: string[] = [];
  const files = skillFiles();
  for (const rel of files) {
    const out = Bun.file(join(SKILL_OUT, rel));
    const src = await Bun.file(join(OWNER_DIR, rel)).bytes();
    if (!(await out.exists()) || Buffer.compare(await out.bytes(), src) !== 0) stale.push(rel);
  }
  if (existsSync(SKILL_OUT))
    for (const rel of walk(SKILL_OUT, SKILL_OUT)) if (!files.includes(rel)) stale.push(`${rel} (extra)`);
  return stale;
}

async function main(): Promise<number> {
  if (Bun.argv.includes("--check")) {
    const stale = await staleSkillFiles();
    if (stale.length) {
      console.error(`skill/ui-ux-pro-max is stale (run bun run build:skill):\n  ${stale.join("\n  ")}`);
      return 1;
    }
    console.log("skill/ui-ux-pro-max is current.");
    return 0;
  }
  rmSync(SKILL_OUT, { recursive: true, force: true });
  const files = skillFiles();
  for (const rel of files) {
    const target = join(SKILL_OUT, rel);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, Bun.file(join(OWNER_DIR, rel)));
  }
  console.log(`Wrote ${files.length} files to ${SKILL_OUT}.`);
  return 0;
}

if (import.meta.main) process.exit(await main());
