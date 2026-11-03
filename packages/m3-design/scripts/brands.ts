// SPDX-License-Identifier: Apache-2.0
/**
 * brands.csv of the ui-ux-pro-max brand domain, generated from the canonical token owner.
 *
 * Every colour comes from `@aphrody/m3-tokens` (the WebAssembly build of crates/aphrody-m3-tokens) through
 * `schemeFromSeed` and the shadcn/Tailwind bridge `FUSION_ALIAS_MAP`; radius and typefaces come from
 * `@aphrody/m3-tokens/m3-tokens.css`. Two seeds are published: the M3 baseline seed that packages/m3-theme
 * ships, and the Bun OS product seed `aphrody_identity::design::pet_seed_hex()`. Nothing is copied by hand.
 */
import { join } from "node:path";
import { FUSION_ALIAS_MAP, schemeFromSeed } from "@aphrody/m3-tokens";
import { productSeed } from "@aphrody/m3-os-themes";
import { formatCsvRecords, type Row } from "../intelligence/ui-ux-pro-max/scripts/csv.ts";
import { contrastRatio } from "../src/contrast.ts";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

export const BRAND_COLUMNS = [
  "No",
  "Brand ID",
  "Brand",
  "Theme",
  "Package",
  "Source File",
  "Selector",
  "Color Scheme",
  "Primary",
  "On Primary",
  "Secondary",
  "On Secondary",
  "Accent",
  "On Accent",
  "Background",
  "Foreground",
  "Card",
  "Card Foreground",
  "Muted",
  "Muted Foreground",
  "Border",
  "Destructive",
  "On Destructive",
  "Ring",
  "Radius",
  "Heading Font",
  "Body Font",
  "Mono Font",
  "Keywords",
  "Notes",
] as const;

/** brands.csv column -> shadcn/Tailwind alias of FUSION_ALIAS_MAP. */
const COLUMN_ALIAS: Record<string, string> = {
  Primary: "primary",
  "On Primary": "primary-foreground",
  Secondary: "secondary",
  "On Secondary": "secondary-foreground",
  Accent: "accent",
  "On Accent": "accent-foreground",
  Background: "background",
  Foreground: "foreground",
  Card: "card",
  "Card Foreground": "card-foreground",
  Muted: "muted",
  "Muted Foreground": "muted-foreground",
  Border: "border",
  Destructive: "destructive",
  "On Destructive": "destructive-foreground",
  Ring: "ring",
};

/** Text pairs that must reach WCAG AA 4.5:1, and the ring that must reach 3:1 against the background. */
const TEXT_PAIRS: [string, string][] = [
  ["On Primary", "Primary"],
  ["On Secondary", "Secondary"],
  ["On Accent", "Accent"],
  ["Foreground", "Background"],
  ["Card Foreground", "Card"],
  ["Muted Foreground", "Muted"],
  ["On Destructive", "Destructive"],
];

interface Seed {
  id: string;
  brand: string;
  seed: string;
  label: string;
  keywords: string;
  package: string;
  sourceFile: string;
}

const M3_TOKENS_CSS = "packages/m3-tokens/src/m3-tokens.css";
const M3_THEME_CSS = "packages/m3-theme/tokens.css";

async function text(relative: string): Promise<string> {
  return Bun.file(join(REPO_ROOT, relative)).text();
}

/** The seed packages/m3-theme/tokens.css is generated from (its header names it). */
async function baselineSeed(): Promise<string> {
  const match = /seed (#[\da-f]{6})/i.exec(await text(M3_THEME_CSS));
  if (!match) throw new Error(`${M3_THEME_CSS}: generator header without a seed`);
  return match[1]!.toLowerCase();
}

function cssValue(css: string, property: string): string {
  const match = new RegExp(`${property}:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`${M3_TOKENS_CSS}: ${property} not found`);
  return match[1]!.trim();
}

const firstFamily = (stack: string) =>
  stack
    .split(",")[0]!
    .trim()
    .replace(/^["']|["']$/g, "");

export async function brandSeeds(): Promise<Seed[]> {
  return [
    {
      id: "m3-baseline",
      brand: "Material 3 (Aphrody)",
      seed: await baselineSeed(),
      label: "M3 baseline",
      keywords: "material 3, m3, material you, baseline, purple, default seed, shadcn bridge",
      package: "@aphrody/m3-theme",
      sourceFile: M3_THEME_CSS,
    },
    {
      id: "aphrody-product",
      brand: "Bun OS (Aphrody)",
      seed: productSeed(REPO_ROOT),
      label: "Bun OS product",
      keywords:
        "bun os, aphrody, product, identity, mauve, pet seed, cosmic, libm3, craft-ui, material 3, m3, shadcn bridge",
      package: "@aphrody/m3-tokens",
      sourceFile: "crates/aphrody-identity/src/design.rs",
    },
  ];
}

/** The generated brands.csv text. */
export async function generateBrandsCsv(): Promise<string> {
  const tokensCss = await text(M3_TOKENS_CSS);
  const radius = cssValue(tokensCss, "--md-sys-shape-corner-medium");
  const brandFont = firstFamily(cssValue(tokensCss, "--md-ref-typeface-brand"));
  const plainFont = firstFamily(cssValue(tokensCss, "--md-ref-typeface-plain"));
  const codeFont = firstFamily(cssValue(tokensCss, "--md-ref-typeface-code"));
  const aliases = new Map<string, string>(FUSION_ALIAS_MAP.map(([alias, role]) => [alias, role]));

  const records: Row[] = [];
  for (const seed of await brandSeeds()) {
    for (const dark of [false, true]) {
      const scheme = dark ? "dark" : "light";
      const roles = schemeFromSeed(seed.seed, { dark });
      const row: Row = {
        No: String(records.length + 1),
        "Brand ID": `${seed.id}-${scheme}`,
        Brand: seed.brand,
        Theme: `${seed.label} ${scheme} (tonal spot, seed ${seed.seed.toUpperCase()})`,
        Package: seed.package,
        "Source File": seed.sourceFile,
        Selector:
          seed.id === "m3-baseline"
            ? dark
              ? ".dark (also :root under @media (prefers-color-scheme: dark))"
              : ":root (.light with @aphrody/bun-plugin-tailwind theme m3)"
            : `cssFromSeed("${seed.seed}"${dark ? ", { dark: true }" : ""}) of @aphrody/m3-tokens; native: libm3 Theme::aphrody(${dark}, Contrast::Standard), craft-ui Palette::get(${dark}, false)`,
        "Color Scheme": scheme,
        Radius: `${radius} (--md-sys-shape-corner-medium, ${M3_TOKENS_CSS})`,
        "Heading Font": brandFont,
        "Body Font": plainFont,
        "Mono Font": codeFont,
        Keywords: `${seed.keywords}, ${scheme}`,
      };
      const sources: string[] = [];
      for (const [column, alias] of Object.entries(COLUMN_ALIAS)) {
        const role = aliases.get(alias);
        if (!role) throw new Error(`FUSION_ALIAS_MAP has no ${alias}`);
        const hex = roles[`--md-sys-color-${role}`];
        if (!hex) throw new Error(`schemeFromSeed omitted --md-sys-color-${role}`);
        row[column] = hex.toUpperCase();
        sources.push(`--${alias}: var(--md-sys-color-${role}) = ${hex.toLowerCase()}`);
      }
      const minText = Math.min(...TEXT_PAIRS.map(([fg, bg]) => contrastRatio(row[fg]!, row[bg]!)));
      const ring = contrastRatio(row.Ring!, row.Background!);
      row.Notes =
        `Generated by packages/m3-design/scripts/brands.ts from schemeFromSeed("${seed.seed}"${dark ? ", { dark: true }" : ""}) ` +
        `of @aphrody/m3-tokens (crates/aphrody-m3-tokens) through FUSION_ALIAS_MAP. ` +
        `Lowest text-pair contrast ${minText.toFixed(2)}:1, ring ${ring.toFixed(2)}:1 against the background. ` +
        `Fonts are --md-ref-typeface-brand/plain/code of ${M3_TOKENS_CSS}. Aliases: ${sources.join("; ")}.`;
      records.push(row);
    }
  }
  return formatCsvRecords(BRAND_COLUMNS, records);
}

if (import.meta.main) process.stdout.write(await generateBrandsCsv());
