/**
 * Material 3 Expressive tokens that the generated `m3-tokens.css` does not carry:
 * the 15 emphasized type styles, the Expressive spatial springs and the directional shapes.
 * Mirrors crates/aphrody-m3-tokens (typography.rs, motion.rs). `expressive.css` is generated from
 * this module: `bun run generate:expressive`.
 */

/** Base style metrics (rem) and base weight, from the generated typescale. */
interface TypeBase {
  font: "brand" | "plain";
  weight: number;
  size: string;
  lineHeight: string;
  tracking: string;
}

const base = (
  font: TypeBase["font"],
  weight: number,
  size: string,
  lineHeight: string,
  tracking: string,
): TypeBase => ({ font, weight, size, lineHeight, tracking });

export const TYPE_BASE = {
  "display-large": base("brand", 400, "3.5625rem", "4rem", "-0.015625rem"),
  "display-medium": base("brand", 400, "2.8125rem", "3.25rem", "0rem"),
  "display-small": base("brand", 400, "2.25rem", "2.75rem", "0rem"),
  "headline-large": base("brand", 400, "2rem", "2.5rem", "0rem"),
  "headline-medium": base("brand", 400, "1.75rem", "2.25rem", "0rem"),
  "headline-small": base("brand", 400, "1.5rem", "2rem", "0rem"),
  "title-large": base("brand", 400, "1.375rem", "1.75rem", "0rem"),
  "title-medium": base("plain", 500, "1rem", "1.5rem", "0.009375rem"),
  "title-small": base("plain", 500, "0.875rem", "1.25rem", "0.00625rem"),
  "body-large": base("plain", 400, "1rem", "1.5rem", "0.03125rem"),
  "body-medium": base("plain", 400, "0.875rem", "1.25rem", "0.015625rem"),
  "body-small": base("plain", 400, "0.75rem", "1rem", "0.025rem"),
  "label-large": base("plain", 500, "0.875rem", "1.25rem", "0.00625rem"),
  "label-medium": base("plain", 500, "0.75rem", "1rem", "0.03125rem"),
  "label-small": base("plain", 500, "0.6875rem", "1rem", "0.03125rem"),
} as const satisfies Record<string, TypeBase>;

export type TypeStyleName = keyof typeof TYPE_BASE;

/** Emphasized weights: display/headline/title-large/body 500; title-medium/small and label 700. */
export const EMPHASIZED_WEIGHT: Record<TypeStyleName, number> = {
  "display-large": 500,
  "display-medium": 500,
  "display-small": 500,
  "headline-large": 500,
  "headline-medium": 500,
  "headline-small": 500,
  "title-large": 500,
  "title-medium": 700,
  "title-small": 700,
  "body-large": 500,
  "body-medium": 500,
  "body-small": 500,
  "label-large": 700,
  "label-medium": 700,
  "label-small": 700,
};

/** Tracking overrides: display-large resets to 0 (it must not inherit -0.25dp); body-large uses 0.15dp. */
const EMPHASIZED_TRACKING: Partial<Record<TypeStyleName, string>> = {
  "display-large": "0rem",
  "body-large": "0.009375rem",
};

export interface EmphasizedStyle {
  name: TypeStyleName;
  font: TypeBase["font"];
  weight: number;
  size: string;
  lineHeight: string;
  tracking: string;
}

export const EMPHASIZED_STYLES: readonly EmphasizedStyle[] = (Object.keys(TYPE_BASE) as TypeStyleName[]).map(name => {
  const b = TYPE_BASE[name];
  return {
    name,
    font: b.font,
    weight: EMPHASIZED_WEIGHT[name],
    size: b.size,
    lineHeight: b.lineHeight,
    tracking: EMPHASIZED_TRACKING[name] ?? b.tracking,
  };
});

export interface SpringToken {
  damping: number;
  stiffness: number;
}

/** `md.sys.motion.spring.{fast,default,slow}.spatial`, Expressive scheme (damping ratio, stiffness). */
export const EXPRESSIVE_SPRINGS = {
  fast: { damping: 0.6, stiffness: 800 },
  default: { damping: 0.8, stiffness: 380 },
  slow: { damping: 0.8, stiffness: 200 },
} as const satisfies Record<string, SpringToken>;

/** Directional corner shapes: `[ltr border-radius, rtl border-radius]` in terms of the corner scale. */
export const DIRECTIONAL_SHAPES = {
  "extra-small-top": ["extra-small extra-small none none", "extra-small extra-small none none"],
  "large-top": ["large large none none", "large large none none"],
  "large-start": ["large none none large", "none large large none"],
  "large-end": ["none large large none", "large none none large"],
  "extra-large-top": ["extra-large extra-large none none", "extra-large extra-large none none"],
} as const;

export type DirectionalShape = keyof typeof DIRECTIONAL_SHAPES;

const corners = (spec: string): string =>
  spec
    .split(" ")
    .map(c => `var(--md-sys-shape-corner-${c})`)
    .join(" ");

/** The stylesheet that `expressive.css` holds. */
export function expressiveCss(): string {
  const type = EMPHASIZED_STYLES.flatMap(s => {
    const p = `--md-sys-typescale-${s.name}-emphasized`;
    return [
      `  ${p}-font: var(--md-ref-typeface-${s.font});`,
      `  ${p}-weight: ${s.weight};`,
      `  ${p}-size: ${s.size};`,
      `  ${p}-line-height: ${s.lineHeight};`,
      `  ${p}-tracking: ${s.tracking};`,
    ];
  }).join("\n");
  const springs = Object.entries(EXPRESSIVE_SPRINGS)
    .flatMap(([k, v]) => [
      `  --md-sys-motion-spring-expressive-${k}-spatial-damping: ${v.damping};`,
      `  --md-sys-motion-spring-expressive-${k}-spatial-stiffness: ${v.stiffness};`,
    ])
    .join("\n");
  const shapes = Object.entries(DIRECTIONAL_SHAPES)
    .map(([k, v]) => `  --md-sys-shape-corner-${k}: ${corners(v[0])};`)
    .join("\n");
  const rtl = Object.entries(DIRECTIONAL_SHAPES)
    .filter(([, v]) => v[0] !== v[1])
    .map(([k, v]) => `  --md-sys-shape-corner-${k}: ${corners(v[1])};`)
    .join("\n");
  return `/* SPDX-License-Identifier: Apache-2.0 */
/*
 * Material 3 Expressive tokens: emphasized typescale, Expressive spatial springs, directional shapes.
 * GENERATED from src/expressive.ts - do not hand-edit: bun run generate:expressive.
 * Requires m3-tokens.css (corner scale and typefaces).
 */

:root {
  /* Typescale: emphasized styles. */
${type}

  /* Motion: Expressive spatial springs (damping ratio, stiffness). */
${springs}

  /* Shape: directional corners (LTR; start/end swap under RTL). */
${shapes}
}

:root:dir(rtl) {
${rtl}
}
`;
}
