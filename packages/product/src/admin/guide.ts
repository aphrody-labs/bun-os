// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error TS2307: Bun text import of the generated sheet (inlined by bun build); TypeScript has no .css text type.
import brandSheet from "../../../app-ui/src/brand.css" with { type: "text" };

// The generated Aphrody brand roles (packages/app-ui/src/brand.css, product seed), switched by the system scheme
// because the standalone page runs no script.
const brandRoles = (brandSheet as string)
  .replace(/:root\.light,\s*\.light\s*\{([^}]*)\}/g, "@media (prefers-color-scheme: light) {\n:root {$1}\n}")
  .replace(/:root,\s*\.dark\s*\{([^}]*)\}/g, "@media (prefers-color-scheme: dark) {\n:root {$1}\n}");

const CSS = `${brandRoles}
body{font:16px/1.5 "Google Sans Flex","Roboto Flex",sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface)}
a{color:var(--md-sys-color-primary)}a:focus-visible{outline:2px solid var(--md-sys-color-secondary);outline-offset:2px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid var(--md-sys-color-outline-variant);padding:.4rem .6rem;text-align:left;vertical-align:top}
code{font-family:"Google Sans Code","Roboto Mono",monospace;background:var(--md-sys-color-surface-container-high);padding:0 .25rem;border-radius:4px}`;

/** docs/operations/omar-guide.md as one standalone page (what the menu's « Ouvrir le guide » shows). */
export function guideHtml(markdown: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aphrody : le guide d'Omar</title><style>${CSS}</style></head><body>${Bun.markdown.html(markdown)}</body></html>\n`;
}
