// SPDX-License-Identifier: Apache-2.0
// GENERATED - do not hand-edit. Source: crates/aphrody-m3-tokens/src/gemini_brand.rs (Sheet::Brand).
// Regenerate with: bun run generate
// design:content - brand artwork colours (logo marks, gradients), not UI chrome roles.

/** Aphrody brand colours (`--aphrody-brand-*`). */
export const APHRODY_BRAND_COLORS = Object.freeze({
  blue: "#4285F4",
  purple: "#9168C0",
  pink: "#EC4899",
  yellow: "#FAE366",
  green: "#BFF28D",
  cyan: "#00BCD4",
  orange: "#FF7043",
  red: "#E53935",
} as const);

/** Aphrody brand gradients (`--aphrody-spectrum-shift`, `--aphrody-*-tone`, `--aphrody-shimmer`). */
export const APHRODY_BRAND_GRADIENTS = Object.freeze({
  spectrumShift:
    "linear-gradient(90deg, var(--aphrody-brand-blue) 0%, var(--aphrody-brand-purple) 50%, var(--aphrody-brand-pink) 100%)",
  warmTone: "linear-gradient(45deg, var(--aphrody-brand-yellow) 0%, var(--aphrody-brand-pink) 100%)",
  successTone: "linear-gradient(135deg, #34A853 0%, var(--aphrody-brand-green) 100%)",
  shimmer: "linear-gradient(90deg, transparent 0%, color-mix(in srgb, white 35%, transparent) 50%, transparent 100%)",
} as const);

/** Aphrody brand corner radii (`--aphrody-corner-*`). */
export const APHRODY_BRAND_SHAPES = Object.freeze({
  card: "16px",
  pill: "9999px",
  chip: "12px",
} as const);

/** The `--aphrody-*` custom properties as one `:root` block. */
export const APHRODY_BRAND_CSS =
  ":root {\n  --aphrody-brand-blue: #4285F4;\n  --aphrody-brand-purple: #9168C0;\n  --aphrody-brand-pink: #EC4899;\n  --aphrody-brand-yellow: #FAE366;\n  --aphrody-brand-green: #BFF28D;\n  --aphrody-brand-cyan: #00BCD4;\n  --aphrody-brand-orange: #FF7043;\n  --aphrody-brand-red: #E53935;\n  --aphrody-spectrum-shift: linear-gradient(90deg, var(--aphrody-brand-blue) 0%, var(--aphrody-brand-purple) 50%, var(--aphrody-brand-pink) 100%);\n  --aphrody-warm-tone: linear-gradient(45deg, var(--aphrody-brand-yellow) 0%, var(--aphrody-brand-pink) 100%);\n  --aphrody-success-tone: linear-gradient(135deg, #34A853 0%, var(--aphrody-brand-green) 100%);\n  --aphrody-shimmer: linear-gradient(90deg, transparent 0%, color-mix(in srgb, white 35%, transparent) 50%, transparent 100%);\n  --aphrody-corner-card: 16px;\n  --aphrody-corner-pill: 9999px;\n  --aphrody-corner-chip: 12px;\n}\n";
