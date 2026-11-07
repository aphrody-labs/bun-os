/**
 * Aphrody OKLCH Color Dynamics Engine (2026 Tier)
 * Perceptually uniform color spaces, wide-gamut Display P3 mappings,
 * and semantic token resolution across light, dark, and high-contrast modes.
 */

export interface OklchColor {
  l: number; // Lightness [0, 1]
  c: number; // Chroma [0, 0.4]
  h: number; // Hue angle [0, 360)
  a?: number; // Alpha [0, 1]
}

export function formatOklch(color: OklchColor): string {
  const alphaStr = color.a !== undefined && color.a < 1 ? ` / ${color.a}` : "";
  return `oklch(${color.l.toFixed(4)} ${color.c.toFixed(4)} ${color.h.toFixed(2)}${alphaStr})`;
}

/**
 * Approximate relative luminance from OKLCH Lightness.
 * Since OKLCH lightness is perceptually uniform, L^3 is a reliable approximation
 * for standard photopic relative luminance in contrast calculations.
 */
export function oklchToLuminance(l: number): number {
  return Math.pow(l, 3);
}

/**
 * Calculates WCAG 2.2 contrast ratio between two OKLCH lightness values.
 */
export function calculateContrast(l1: number, l2: number): number {
  const lum1 = oklchToLuminance(l1);
  const lum2 = oklchToLuminance(l2);
  const brighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (brighter + 0.05) / (darker + 0.05);
}

/**
 * 49 Semantic Roles defined in OKLCH coordinates for Aphrody Dark & Light
 */
export const CRAFT_THEME_DARK = {
  // Primary & Accents (Aphrody Divine Cyan-Violet Spectrum)
  primary: { l: 0.82, c: 0.14, h: 220 },
  onPrimary: { l: 0.15, c: 0.05, h: 220 },
  primaryContainer: { l: 0.28, c: 0.08, h: 220 },
  onPrimaryContainer: { l: 0.92, c: 0.06, h: 220 },

  // Secondary (Muted Amethyst Slate)
  secondary: { l: 0.78, c: 0.07, h: 275 },
  onSecondary: { l: 0.18, c: 0.04, h: 275 },
  secondaryContainer: { l: 0.26, c: 0.05, h: 275 },
  onSecondaryContainer: { l: 0.88, c: 0.04, h: 275 },

  // Tertiary (Solar Gold / Byron Spark)
  tertiary: { l: 0.84, c: 0.13, h: 78 },
  onTertiary: { l: 0.2, c: 0.06, h: 78 },
  tertiaryContainer: { l: 0.32, c: 0.07, h: 78 },
  onTertiaryContainer: { l: 0.94, c: 0.05, h: 78 },

  // Surface Hierarchy
  surface: { l: 0.12, c: 0.015, h: 235 },
  onSurface: { l: 0.93, c: 0.01, h: 235 },
  surfaceVariant: { l: 0.2, c: 0.02, h: 235 },
  onSurfaceVariant: { l: 0.8, c: 0.02, h: 235 },
  surfaceContainerLowest: { l: 0.08, c: 0.01, h: 235 },
  surfaceContainerLow: { l: 0.14, c: 0.015, h: 235 },
  surfaceContainer: { l: 0.17, c: 0.018, h: 235 },
  surfaceContainerHigh: { l: 0.21, c: 0.02, h: 235 },
  surfaceContainerHighest: { l: 0.25, c: 0.022, h: 235 },

  // Outlines & Borders
  outline: { l: 0.45, c: 0.02, h: 235 },
  outlineVariant: { l: 0.26, c: 0.02, h: 235 },

  // Feedback
  error: { l: 0.72, c: 0.18, h: 25 },
  onError: { l: 0.15, c: 0.08, h: 25 },
  success: { l: 0.75, c: 0.16, h: 145 },
  onSuccess: { l: 0.15, c: 0.06, h: 145 },
  warning: { l: 0.82, c: 0.17, h: 85 },
  onWarning: { l: 0.2, c: 0.07, h: 85 },

  // Glass Specular & Ambient
  glassBorder: { l: 1.0, c: 0.0, h: 0, a: 0.12 },
  glassSurface: { l: 0.16, c: 0.02, h: 235, a: 0.65 },
  glassReflect: { l: 1.0, c: 0.0, h: 0, a: 0.06 },
} as const;

export const CRAFT_THEME_LIGHT = {
  primary: { l: 0.42, c: 0.16, h: 225 },
  onPrimary: { l: 0.98, c: 0.01, h: 225 },
  primaryContainer: { l: 0.88, c: 0.06, h: 225 },
  onPrimaryContainer: { l: 0.16, c: 0.08, h: 225 },

  secondary: { l: 0.44, c: 0.08, h: 275 },
  onSecondary: { l: 0.98, c: 0.01, h: 275 },
  secondaryContainer: { l: 0.89, c: 0.04, h: 275 },
  onSecondaryContainer: { l: 0.18, c: 0.05, h: 275 },

  tertiary: { l: 0.48, c: 0.14, h: 78 },
  onTertiary: { l: 0.99, c: 0.01, h: 78 },
  tertiaryContainer: { l: 0.9, c: 0.06, h: 78 },
  onTertiaryContainer: { l: 0.22, c: 0.07, h: 78 },

  surface: { l: 0.98, c: 0.005, h: 235 },
  onSurface: { l: 0.15, c: 0.02, h: 235 },
  surfaceVariant: { l: 0.91, c: 0.015, h: 235 },
  onSurfaceVariant: { l: 0.35, c: 0.02, h: 235 },
  surfaceContainerLowest: { l: 1.0, c: 0.0, h: 0 },
  surfaceContainerLow: { l: 0.96, c: 0.008, h: 235 },
  surfaceContainer: { l: 0.94, c: 0.01, h: 235 },
  surfaceContainerHigh: { l: 0.91, c: 0.015, h: 235 },
  surfaceContainerHighest: { l: 0.88, c: 0.02, h: 235 },

  outline: { l: 0.65, c: 0.02, h: 235 },
  outlineVariant: { l: 0.82, c: 0.015, h: 235 },

  error: { l: 0.52, c: 0.22, h: 25 },
  onError: { l: 0.99, c: 0.01, h: 25 },
  success: { l: 0.5, c: 0.18, h: 145 },
  onSuccess: { l: 0.99, c: 0.01, h: 145 },
  warning: { l: 0.55, c: 0.18, h: 85 },
  onWarning: { l: 0.99, c: 0.01, h: 85 },

  glassBorder: { l: 0.0, c: 0.0, h: 0, a: 0.08 },
  glassSurface: { l: 0.98, c: 0.005, h: 235, a: 0.72 },
  glassReflect: { l: 1.0, c: 0.0, h: 0, a: 0.4 },
} as const;

/**
 * Generate CSS variable block for root attachment.
 */
export function generateCssVariables(isDark = true): string {
  const theme = isDark ? CRAFT_THEME_DARK : CRAFT_THEME_LIGHT;
  const lines: string[] = [];

  for (const [key, color] of Object.entries(theme)) {
    const cssName = `--craft-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
    lines.push(`  ${cssName}: ${formatOklch(color)};`);
  }

  return lines.join("\n");
}
