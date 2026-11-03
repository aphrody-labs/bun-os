// SPDX-License-Identifier: MIT
// Where the skill tree and the browser runtime live. The same code runs from the workspace package (src/) and
// bundled into the distributable skill (plugin/skills/3dviz-pro-max/scripts/), so both layouts are probed.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** packages/viz3d in the workspace; the skill directory once bundled. */
export const HERE_PARENT = resolve(import.meta.dir, "..");

const bundled = existsSync(join(HERE_PARENT, "data/manifest.json"));

/** The skill root: data/, references/, templates/, schemas/ (VIZ3D_SKILL_ROOT overrides). */
export function skillRoot(): string {
  if (Bun.env.VIZ3D_SKILL_ROOT) return resolve(Bun.env.VIZ3D_SKILL_ROOT);
  return bundled ? HERE_PARENT : join(HERE_PARENT, "plugin/skills/3dviz-pro-max");
}

/** Browser runtime of the kit viewer (kit.html, kit-viewer.js, m3.css). */
export function runtimeDir(): string {
  return join(HERE_PARENT, "runtime");
}

/** The runnable studies ship with the workspace package only. */
export function studiesDir(): string | null {
  const dir = join(HERE_PARENT, "studies");
  return existsSync(join(dir, "index.html")) ? dir : null;
}

/** packages/viz3d when running from the workspace, else null. */
export function packageRoot(): string | null {
  return bundled ? null : HERE_PARENT;
}
