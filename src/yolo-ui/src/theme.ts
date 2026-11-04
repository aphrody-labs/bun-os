// SPDX-License-Identifier: Apache-2.0
/**
 * YOLO UI Dynamic Theme Engine
 * Pure Rust & Bun OS customizable design system replacing legacy static M3 schemes.
 */

export interface ColorRgb {
  r: number;
  g: number;
  b: number;
}

export interface DynamicPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceHover: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

export interface YoloTheme {
  name: string;
  mode: "dark" | "light";
  style: "classic" | "glass" | "neobrutal" | "cosmic" | "cyberpunk";
  palette: DynamicPalette;
  tokens: Record<string, string>;
}

/** Parse hex color string into 0-255 RGB values. */
export function hexToRgb(hex: string): ColorRgb {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** Convert RGB components to #rrggbb hex string. */
export function rgbToHex({ r, g, b }: ColorRgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Calculate standard sRGB relative luminance. */
export function relativeLuminance({ r, g, b }: ColorRgb): number {
  const a = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** Calculate standard WCAG contrast ratio between two colors. */
export function calculateContrast(colorA: string, colorB: string): number {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/** Check WCAG 2.2 AA (4.5:1) and AAA (7.0:1) compliance. */
export function checkWcag(colorA: string, colorB: string): { ratio: number; aa: boolean; aaa: boolean } {
  const ratio = calculateContrast(colorA, colorB);
  return {
    ratio,
    aa: ratio >= 4.5,
    aaa: ratio >= 7.0,
  };
}

/**
 * Generate a dynamic customizable YOLO UI theme from any seed color.
 */
export function generateYoloTheme(
  seedHex: string,
  options: {
    mode?: "dark" | "light";
    style?: "classic" | "glass" | "neobrutal" | "cosmic" | "cyberpunk";
    accentOverride?: string;
  } = {}
): YoloTheme {
  const mode = options.mode ?? "dark";
  const style = options.style ?? "cosmic";
  const seedRgb = hexToRgb(seedHex);

  // Generate harmonized secondary and accent
  const secondaryRgb: ColorRgb = {
    r: Math.round(seedRgb.r * 0.7 + seedRgb.b * 0.3),
    g: Math.round(seedRgb.g * 0.8 + seedRgb.r * 0.2),
    b: Math.round(seedRgb.b * 0.9 + seedRgb.g * 0.1),
  };

  const accentRgb: ColorRgb = options.accentOverride
    ? hexToRgb(options.accentOverride)
    : {
        r: 255 - seedRgb.r,
        g: Math.round(seedRgb.b * 0.8),
        b: 255 - seedRgb.g,
      };

  const isDark = mode === "dark";
  const palette: DynamicPalette = {
    primary: rgbToHex(seedRgb),
    secondary: rgbToHex(secondaryRgb),
    accent: rgbToHex(accentRgb),
    background: isDark ? "#0b0d13" : "#f8f9fc",
    surface: isDark ? "#141824" : "#ffffff",
    surfaceHover: isDark ? "#1d2335" : "#edf0f7",
    textPrimary: isDark ? "#f3f4f8" : "#11141d",
    textSecondary: isDark ? "#9ca3af" : "#4b5563",
    border: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
  };

  const tokens: Record<string, string> = {
    "--yolo-primary": palette.primary,
    "--yolo-secondary": palette.secondary,
    "--yolo-accent": palette.accent,
    "--yolo-bg": palette.background,
    "--yolo-surface": palette.surface,
    "--yolo-surface-hover": palette.surfaceHover,
    "--yolo-text-primary": palette.textPrimary,
    "--yolo-text-secondary": palette.textSecondary,
    "--yolo-border": palette.border,
    "--yolo-radius": style === "neobrutal" ? "0px" : style === "glass" ? "16px" : "10px",
    "--yolo-blur": style === "glass" ? "12px" : "0px",
    "--yolo-shadow":
      style === "neobrutal"
        ? "4px 4px 0px #000000"
        : isDark
          ? "0 8px 32px rgba(0, 0, 0, 0.37)"
          : "0 4px 20px rgba(0, 0, 0, 0.05)",
  };

  return {
    name: `yolo-${style}-${mode}`,
    mode,
    style,
    palette,
    tokens,
  };
}

/**
 * Export theme as CSS Custom Properties string.
 */
export function exportCssTokens(theme: YoloTheme): string {
  const lines = Object.entries(theme.tokens).map(([k, v]) => `  ${k}: ${v};`);
  return `:root[data-theme="${theme.name}"] {\n${lines.join("\n")}\n}`;
}

/**
 * Export theme as Rust Iced / LibCosmic color struct.
 */
export function exportRustTokens(theme: YoloTheme): string {
  const p = theme.palette;
  return `// Generated by YOLO UI Pure Rust Theme Engine
pub struct YoloThemePalette {
    pub primary: iced::Color,
    pub secondary: iced::Color,
    pub accent: iced::Color,
    pub background: iced::Color,
    pub surface: iced::Color,
}

impl Default for YoloThemePalette {
    fn default() -> Self {
        Self {
            primary: iced::Color::from_rgb8(${hexToRgb(p.primary).r}, ${hexToRgb(p.primary).g}, ${hexToRgb(p.primary).b}),
            secondary: iced::Color::from_rgb8(${hexToRgb(p.secondary).r}, ${hexToRgb(p.secondary).g}, ${hexToRgb(p.secondary).b}),
            accent: iced::Color::from_rgb8(${hexToRgb(p.accent).r}, ${hexToRgb(p.accent).g}, ${hexToRgb(p.accent).b}),
            background: iced::Color::from_rgb8(${hexToRgb(p.background).r}, ${hexToRgb(p.background).g}, ${hexToRgb(p.background).b}),
            surface: iced::Color::from_rgb8(${hexToRgb(p.surface).r}, ${hexToRgb(p.surface).g}, ${hexToRgb(p.surface).b}),
        }
    }
}`;
}
