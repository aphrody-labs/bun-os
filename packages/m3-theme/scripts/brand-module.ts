// SPDX-License-Identifier: Apache-2.0
// Turns the Rust brand sheet (`m3Css({ sheet: "brand" })`, `aphrody_m3_tokens::sheets::Sheet::Brand`,
// rendered by `gemini_brand::export_aphrody_brand_css`) into `src/brand.ts`. Only the `--aphrody-*`
// brand declarations are carried over: the sheet's `--m3-*` baseline companions duplicate the roles
// of `tokens.css` and are not a second palette for TypeScript consumers.

const camel = (kebab: string): string => kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** `--aphrody-*` declarations of the sheet, in order. */
export function brandDeclarations(css: string): [string, string][] {
  return [...css.matchAll(/^\s*(--aphrody-[a-z0-9-]+):\s*([^;]+);/gm)].map(m => [m[1]!, m[2]!.trim()]);
}

function group(entries: [string, string][], prefix: string, suffix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    out[camel(name.slice(prefix.length, name.length - suffix.length))] = value;
  }
  return out;
}

const literal = (record: Record<string, string>): string =>
  `{\n${Object.entries(record)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join("\n")}\n}`;

/** Contents of `src/brand.ts` for one rendering of the brand sheet. */
export function brandModule(css: string): string {
  const entries = brandDeclarations(css);
  if (entries.length === 0) throw new Error("brand sheet: no --aphrody-* declarations");
  const colors = group(entries, "--aphrody-brand-");
  const shapes = group(entries, "--aphrody-corner-");
  const gradients = Object.fromEntries(
    entries
      .filter(([name]) => !name.startsWith("--aphrody-brand-") && !name.startsWith("--aphrody-corner-"))
      .map(([name, value]) => [camel(name.slice("--aphrody-".length)), value]),
  );
  const sheet = `:root {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;
  return `// SPDX-License-Identifier: Apache-2.0
// GENERATED - do not hand-edit. Source: crates/aphrody-m3-tokens/src/gemini_brand.rs (Sheet::Brand).
// Regenerate with: bun run generate
// design:content - brand artwork colours (logo marks, gradients), not UI chrome roles.

/** Aphrody brand colours (\`--aphrody-brand-*\`). */
export const APHRODY_BRAND_COLORS = Object.freeze(${literal(colors)} as const);

/** Aphrody brand gradients (\`--aphrody-spectrum-shift\`, \`--aphrody-*-tone\`, \`--aphrody-shimmer\`). */
export const APHRODY_BRAND_GRADIENTS = Object.freeze(${literal(gradients)} as const);

/** Aphrody brand corner radii (\`--aphrody-corner-*\`). */
export const APHRODY_BRAND_SHAPES = Object.freeze(${literal(shapes)} as const);

/** The \`--aphrody-*\` custom properties as one \`:root\` block. */
export const APHRODY_BRAND_CSS = ${JSON.stringify(sheet)};
`;
}
