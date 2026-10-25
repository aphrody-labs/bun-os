// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical Gemini AI & Google Design Brand Tokens.
 * Mirrored from Rust `crates/aphrody-m3-tokens/src/gemini_brand.rs`.
 */

export const GEMINI_BRAND_COLORS = Object.freeze({
  blue: "#3186FF",
  purple: "#9B72CB",
  pink: "#D96570",
  yellow: "#FFCC00",
  green: "#0EBC5F",
  red: "#FF4641",
  titleBlue: "#4285F4",
  titlePurple: "#9B72CB",
  titlePink: "#D96570",
} as const);

export const GEMINI_BRAND_GRADIENTS = Object.freeze({
  spectrumShift: "linear-gradient(74deg, #4285F4 0%, #9B72CB 18%, #D96570 35%, #D96570 50%, #9B72CB 70%, #4285F4 100%)",
  sparkle: "radial-gradient(circle, rgba(66, 133, 244, 0.15) 0%, rgba(155, 114, 203, 0.1) 50%, transparent 70%)",
  warmTone: "linear-gradient(45deg, #FFCC00 0%, #D96570 100%)",
  shimmer: "linear-gradient(90deg, transparent 0%, color-mix(in srgb, white 35%, transparent) 50%, transparent 100%)",
} as const);

export const GEMINI_BRAND_SHAPES = Object.freeze({
  promptBar: "32px",
  promptBarInitial: "40px",
  promptBarDocked: "24px 24px 0 0",
  message: "24px",
  chip: "16px",
  card: "16px",
  pill: "9999px",
} as const);

/**
 * Generates runtime CSS variables declaring the complete Gemini / Google brand cascade.
 */
export function getGeminiBrandCss(): string {
  return `:root {
  --gemini-brand-blue: ${GEMINI_BRAND_COLORS.blue};
  --gemini-brand-purple: ${GEMINI_BRAND_COLORS.purple};
  --gemini-brand-pink: ${GEMINI_BRAND_COLORS.pink};
  --gemini-brand-yellow: ${GEMINI_BRAND_COLORS.yellow};
  --gemini-brand-green: ${GEMINI_BRAND_COLORS.green};
  --gemini-brand-red: ${GEMINI_BRAND_COLORS.red};

  --gemini-spectrum-shift: ${GEMINI_BRAND_GRADIENTS.spectrumShift};
  --gemini-sparkle: ${GEMINI_BRAND_GRADIENTS.sparkle};
  --gemini-warm-tone: ${GEMINI_BRAND_GRADIENTS.warmTone};
  --gemini-shimmer: ${GEMINI_BRAND_GRADIENTS.shimmer};

  --gemini-corner-prompt-bar: ${GEMINI_BRAND_SHAPES.promptBar};
  --gemini-corner-prompt-bar-initial: ${GEMINI_BRAND_SHAPES.promptBarInitial};
  --gemini-corner-prompt-bar-docked: ${GEMINI_BRAND_SHAPES.promptBarDocked};
  --gemini-corner-message: ${GEMINI_BRAND_SHAPES.message};
  --gemini-corner-chip: ${GEMINI_BRAND_SHAPES.chip};
}`;
}
