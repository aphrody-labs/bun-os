// SPDX-License-Identifier: MIT
// Upstream command lines and script names, rewritten to the Bun entry points the skill ships (scripts/*.js).
// Shared by sync-upstream.ts (references, template READMEs, studies) and build-skill.ts (SKILL.md).
const REWRITES: [RegExp, string][] = [
  [/python3 scripts\/kit-proof\.py --record (\S+)/g, "bun scripts/capture.js --kit $1 --all-views"],
  [/python3 scripts\/([a-z_-]+)\.py/g, "bun scripts/$1.js"],
  [/\b(hero-tier|host-probe|capture|search|resolve|design-context|blender_locate|validate|kit-proof)\.py\b/g, "$1.js"],
  [/\bblender_locate\.js/g, "blender-locate.js"],
  [/\bkit-proof\.js/g, "capture.js --kit"],
  [/^(\s*)pnpm build$/gm, "$1bun run build"],
];

export function rewrite(text: string): string {
  return REWRITES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
