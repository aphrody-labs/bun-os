#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Build the distributable 3Dviz Pro Max skill from this package into plugin/skills/3dviz-pro-max (committed, the
// `skills/` directory a Claude Code or Codex plugin points at):
//
//   bun scripts/build-skill.ts
//
// - runtime/m3.css: the Bun OS M3 sheet, generated from the product theme (@aphrody/m3-os-themes);
// - scripts/*.js: the Bun entry points (src/bin/*.ts) bundled with Bun.build, self-contained, shared chunks beside;
// - runtime/: the kit viewer page, its CSS and the M3 sheet, served by scripts/serve.js and capture.js;
// - templates/scaffold-bun-threejs and templates/rigs/post-stack-webgpu.js: the Bun OS WebGPU scaffold;
// - SKILL.md: upstream's skill text with Bun commands and the Bun OS section; NOTICE: attribution.
// The data, references and upstream templates come from scripts/sync-upstream.ts and are not touched here.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUNOS_THEME, generateCssSheet } from "@aphrody/m3-os-themes";
import { rewrite } from "./rewrite.ts";

const PACKAGE = resolve(import.meta.dir, "..");
const SKILL = join(PACKAGE, "plugin/skills/3dviz-pro-max");
if (!existsSync(join(SKILL, "data/manifest.json"))) {
  console.error("no synced skill data: run bun scripts/sync-upstream.ts first");
  process.exit(2);
}
const upstream = JSON.parse(readFileSync(join(PACKAGE, "upstream/UPSTREAM.json"), "utf8")) as { commit: string };

// 1. The M3 sheet every piece of chrome reads.
const m3 = generateCssSheet(BUNOS_THEME);
writeFileSync(join(PACKAGE, "runtime/m3.css"), m3);

// 2. Bun entry points. Chunks sit beside the entries so import.meta.dir is the scripts folder in every file.
const scripts = join(SKILL, "scripts");
rmSync(scripts, { recursive: true, force: true });
const entries = readdirSync(join(PACKAGE, "src/bin"))
  .filter(name => name.endsWith(".ts"))
  .sort()
  .map(name => join(PACKAGE, "src/bin", name));
const result = await Bun.build({
  entrypoints: entries,
  outdir: scripts,
  target: "bun",
  format: "esm",
  splitting: true,
  naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
  banner: `// 3Dviz Pro Max helpers for Bun (MIT): built by Bun OS packages/viz3d from aphrody-labs/3dviz-pro-max@${upstream.commit.slice(0, 12)}. Do not edit; see NOTICE.`,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// 3. The browser runtime and the Bun OS templates.
rmSync(join(SKILL, "runtime"), { recursive: true, force: true });
cpSync(join(PACKAGE, "runtime"), join(SKILL, "runtime"), { recursive: true });
const scaffold = join(SKILL, "templates/scaffold-bun-threejs");
rmSync(scaffold, { recursive: true, force: true });
cpSync(join(PACKAGE, "bunos/scaffold-bun-threejs"), scaffold, { recursive: true });
cpSync(join(SKILL, "templates/scaffold-vite-threejs/scene.js"), join(scaffold, "scene.js"));
cpSync(join(SKILL, "templates/scaffold-vite-threejs/viewer-contract.js"), join(scaffold, "viewer-contract.js"));
writeFileSync(join(scaffold, "m3.css"), m3);
for (const rig of readdirSync(join(PACKAGE, "bunos/rigs"))) cpSync(join(PACKAGE, "bunos/rigs", rig), join(SKILL, "templates/rigs", rig));
const templatesIndex = join(SKILL, "templates/README.md");
const index = readFileSync(templatesIndex, "utf8");
const row =
  "| [scaffold-bun-threejs/](scaffold-bun-threejs/README.md) | Bun OS: the same scene on Bun build/serve and three 0.186 WebGPURenderer (WebGL2 fallback), M3 panel. |";
if (!index.includes("scaffold-bun-threejs")) {
  writeFileSync(templatesIndex, index.replace(/(\| \[scaffold-vite-threejs\/\][^\n]*\n)/, `$1${row}\n`));
}

// 4. SKILL.md: upstream text, Bun commands, the Bun OS section before the workflow.
const skillText = rewrite(readFileSync(join(PACKAGE, "upstream/SKILL.md"), "utf8"));
const section = readFileSync(join(PACKAGE, "bunos/skill-section.md"), "utf8").trim();
if (!skillText.includes("\n## Workflow")) throw new Error("upstream SKILL.md lost its ## Workflow heading");
writeFileSync(join(SKILL, "SKILL.md"), skillText.replace("\n## Workflow", `\n${section}\n\n## Workflow`));
writeFileSync(
  join(SKILL, "NOTICE"),
  `3Dviz Pro Max
Copyright (c) 2026 Viettranx. MIT License (LICENSE). https://github.com/viettranx/3dviz-pro-max
Data, references, templates, schemas and agents/ are upstream's, from the aphrody-labs/3dviz-pro-max fork at
${upstream.commit}.

Bun OS port: scripts/*.js (bundled from packages/viz3d/src of https://github.com/aphrody-labs/bun-os), runtime/,
templates/scaffold-bun-threejs/, templates/rigs/post-stack-webgpu.js and the "Bun OS" section of SKILL.md.
Copyright (c) 2026 aphrody-dev <contact@aphrody.com>. MIT License, same terms as LICENSE.

The bundled scripts include code from @aphrody/chromium (Apache-2.0 and MIT), @aphrody/bun-blender (MIT),
@aphrody/m3-design's difflib port (Apache-2.0), Ajv and ajv-formats (MIT). The study meshes fetched on demand
are BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 Japan.
`,
);

const files = readdirSync(scripts);
console.log(JSON.stringify({ skill: SKILL, scripts: files.filter(f => !f.startsWith("chunk-")), chunks: files.filter(f => f.startsWith("chunk-")).length }));
