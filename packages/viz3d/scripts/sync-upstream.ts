#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Mirror the pinned aphrody-labs/3dviz-pro-max fork (vendor/3dviz-pro-max) into this package:
//
//   bun scripts/sync-upstream.ts [--from <fork checkout>]
//
// - plugin/skills/3dviz-pro-max/{data,references,templates,agents,schemas,LICENSE}: the skill's data and
//   documents, with the upstream Python commands rewritten to the Bun entry points of scripts/build-skill.ts;
// - upstream/SKILL.md: the upstream skill text that build-skill.ts turns into the Bun OS SKILL.md;
// - studies/: the runnable Three.js studies (examples/), without the Vite and pnpm files and the node:test suites;
// - upstream/UPSTREAM.json: the pinned commit.
//
// Data stays data: nothing here edits a record. Run build-skill.ts afterwards (package script `sync` runs both).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { rewrite } from "./rewrite.ts";

const PACKAGE = resolve(import.meta.dir, "..");
const argv = Bun.argv.slice(2);
const fromIndex = argv.indexOf("--from");
const FORK = resolve(fromIndex >= 0 && argv[fromIndex + 1] ? argv[fromIndex + 1]! : join(PACKAGE, "../../vendor/3dviz-pro-max"));
const SKILL_SRC = join(FORK, "skills/3dviz-pro-max");
const SKILL_OUT = join(PACKAGE, "plugin/skills/3dviz-pro-max");

if (!existsSync(join(SKILL_SRC, "data/manifest.json"))) {
  console.error(`no 3dviz-pro-max checkout at ${FORK}: run git submodule update --init vendor/3dviz-pro-max`);
  process.exit(2);
}

function git(args: string[]): string {
  return Bun.spawnSync(["git", "-C", FORK, ...args]).stdout.toString().trim();
}

function copyTree(from: string, to: string, transform?: (path: string) => boolean | "rewrite"): void {
  rmSync(to, { recursive: true, force: true });
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const src = join(dir, name);
      const rel = relative(from, src).replaceAll("\\", "/");
      const mode = transform ? transform(rel) : true;
      if (mode === false) continue;
      if (statSync(src).isDirectory()) {
        walk(src);
        continue;
      }
      const dst = join(to, rel);
      mkdirSync(dirname(dst), { recursive: true });
      if (mode === "rewrite") writeFileSync(dst, rewrite(readFileSync(src, "utf8")));
      else cpSync(src, dst);
    }
  };
  walk(from);
}

const markdown = (rel: string) => (rel.endsWith(".md") ? "rewrite" : true);
copyTree(join(SKILL_SRC, "data"), join(SKILL_OUT, "data"));
copyTree(join(SKILL_SRC, "references"), join(SKILL_OUT, "references"), markdown);
copyTree(join(SKILL_SRC, "agents"), join(SKILL_OUT, "agents"));
// The Bun OS scaffold (templates/scaffold-bun-threejs) is written by build-skill.ts after this copy.
copyTree(join(SKILL_SRC, "templates"), join(SKILL_OUT, "templates"), markdown);
copyTree(join(FORK, "schemas"), join(SKILL_OUT, "schemas"));
cpSync(join(FORK, "LICENSE"), join(SKILL_OUT, "LICENSE"));
mkdirSync(join(PACKAGE, "upstream"), { recursive: true });
cpSync(join(SKILL_SRC, "SKILL.md"), join(PACKAGE, "upstream/SKILL.md"));

const DROP = new Set(["package.json", "pnpm-lock.yaml", "vite.config.js", "scripts", "node_modules", "dist", "public"]);
copyTree(join(FORK, "examples"), join(PACKAGE, "studies"), rel => {
  if (DROP.has(rel.split("/")[0]!)) return false;
  if (/\.test\.js$/.test(rel)) return false;
  return markdown(rel);
});

const commit = git(["rev-parse", "HEAD"]);
const pin = {
  fork: "https://github.com/aphrody-labs/3dviz-pro-max",
  upstream: "https://github.com/viettranx/3dviz-pro-max",
  license: "MIT",
  commit,
  committed: git(["log", "-1", "--format=%cI"]),
  subject: git(["log", "-1", "--format=%s"]),
};
writeFileSync(join(PACKAGE, "upstream/UPSTREAM.json"), `${JSON.stringify(pin, null, 2)}\n`);
const count = (dir: string): number =>
  readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length;
console.log(
  JSON.stringify({
    commit,
    data_files: count(join(SKILL_OUT, "data")),
    template_files: count(join(SKILL_OUT, "templates")),
    study_files: count(join(PACKAGE, "studies")),
  }),
);
