import { readFileSync } from "node:fs";
import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// Tailwind v3 adapter over the canonical M3 mapping: every role utility that
// @aphrody/m3-theme/tailwind.css exposes to Tailwind v4 (--color-<role>) is
// re-exposed here through m3Color(), so opacity modifiers keep working.
const m3Color = (role: string, namespace: "sys" | "ext" = "sys") =>
  `rgb(from var(--md-${namespace}-color-${role}) r g b / <alpha-value>)`;

const m3Roles: Record<string, string> = Object.fromEntries(
  [
    ...readFileSync(new URL("../../packages/m3-theme/tailwind.css", import.meta.url), "utf8").matchAll(
      /--color-([a-z-]+):\s*var\(\s*--md-(sys|ext)-color-([a-z-]+)/g,
    ),
  ].map(([, utility, namespace, role]) => [utility, m3Color(role, namespace as "sys" | "ext")]),
);

export default {
  content: [
    "./app/index.html",
    "./app/src/**/*.{js,jsx,ts,tsx}",
    "./app/src/*.{js,jsx,ts,tsx}",
    "../../packages/storyteller-*/src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        "custom-font": ["Fira Sans", "sans-serif"],
        // Brutalist type system, matching artcraft-webapp.
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        display: [
          "Archivo",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-100%)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.2s ease-in-out",
        shimmer: "shimmer 2s ease-in-out infinite",
        marquee: "marquee 8s linear infinite paused",
      },
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      ...m3Roles,
      primary: {
        DEFAULT: m3Color("primary"),
        "50": m3Color("primary-fixed"),
        "100": m3Color("primary-fixed"),
        "200": m3Color("primary-fixed-dim"),
        "300": m3Color("inverse-primary"),
        "400": m3Color("primary"),
        "500": m3Color("primary"),
        "600": m3Color("inverse-primary"),
        "700": m3Color("primary-container"),
        "800": m3Color("on-primary-container"),
        "900": m3Color("on-primary-fixed-variant"),
        "950": m3Color("on-primary-fixed"),
      },
      "primary-foreground": m3Color("on-primary"),
      secondary: {
        DEFAULT: m3Color("secondary"),
        container: m3Color("secondary-container"),
        foreground: m3Color("on-secondary"),
        border: m3Color("outline-variant"),
      },
      "brand-primary": {
        DEFAULT: m3Color("primary"),
        "950": m3Color("on-primary-fixed"),
      },
      "brand-secondary": {
        DEFAULT: m3Color("surface-container-highest"),
        "500": m3Color("surface-container-high"),
        "600": m3Color("surface-container-highest"),
        "800": m3Color("surface-container"),
      },
      danger: m3Color("error"),
      action: m3Color("surface-container-highest"),
      // Tailwind palettes stay available for content colours (picker swatches,
      // clip-type hues) in the Storyteller packages; chrome uses the roles above.
      white: colors.white,
      black: colors.black,
      gray: colors.gray,
      blue: { ...colors.blue, DEFAULT: m3Color("primary") },
      red: { ...colors.red, DEFAULT: m3Color("error") },
      green: { ...colors.green, DEFAULT: m3Color("success", "ext") },
      yellow: colors.yellow,
      purple: colors.purple,
      pink: colors.pink,
      orange: colors.orange,
      amber: colors.amber,
      emerald: colors.emerald,
      teal: colors.teal,
      cyan: colors.cyan,
      sky: colors.sky,
      violet: colors.violet,
      fuchsia: colors.fuchsia,
      rose: colors.rose,
      indigo: colors.indigo,
      lime: colors.lime,
      ui: {
        background: m3Color("surface"),
        panel: m3Color("surface-container"),
        "panel-border": m3Color("outline-variant"),
        border: m3Color("outline-variant"),
        modal: m3Color("surface-container-high"),
        controls: m3Color("surface-container-highest"),
        "controls-button": m3Color("surface-container-highest"),
        "controls-border": m3Color("outline"),
        divider: m3Color("outline-variant"),
        ink: m3Color("on-surface"),
        "accent-ink": m3Color("primary"),
        sunken: m3Color("surface-container-lowest"),
      },
      "base-fg": m3Color("on-surface"),
      // design:content: X/Y/Z axis hues of the transform gizmo and vector
      // inputs follow the 3D convention (red X, green Y, blue Z).
      "axis-x": "#D33242",
      "axis-y": "#308752",
      "axis-z": "#2E70FF",

      // shadcn aliases consumed by @storyteller/ui-video-editor.
      foreground: m3Color("on-surface"),
      card: {
        DEFAULT: m3Color("surface-container-low"),
        foreground: m3Color("on-surface"),
      },
      popover: {
        DEFAULT: m3Color("surface-container"),
        foreground: m3Color("on-surface"),
        hover: m3Color("surface-container-high"),
      },
      muted: {
        DEFAULT: m3Color("surface-container-high"),
        foreground: m3Color("on-surface-variant"),
      },
      accent: {
        DEFAULT: m3Color("tertiary-container"),
        foreground: m3Color("on-tertiary-container"),
      },
      destructive: {
        DEFAULT: m3Color("error"),
        foreground: m3Color("on-error"),
      },
      border: m3Color("outline-variant"),
      input: m3Color("outline"),
      ring: m3Color("primary"),
    },
  },
  plugins: [],
  safelist: [
    // lucide-react adds this class at runtime; keep the base-layer sizing rule
    // in styles/tailwind.css from being purged.
    "lucide",
  ],
} satisfies Config & { safelist: string[] };
