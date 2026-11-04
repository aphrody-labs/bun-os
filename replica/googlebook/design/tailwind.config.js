// SPDX-License-Identifier: Apache-2.0
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        gb: {
          bg: "var(--gb-bg)",
          surface: "var(--gb-surface)",
          "surface-elevated": "var(--gb-surface-elevated)",
          border: "var(--gb-border)",
          "border-focus": "var(--gb-border-focus)",
          text: "var(--gb-text)",
          "text-muted": "var(--gb-text-muted)",
          accent: "var(--gb-accent)",
          "on-accent": "var(--gb-on-accent)",
          glow: "var(--gb-glow)",
          "glow-bar": "var(--gb-glow-bar)",
          success: "var(--gb-success)",
          warning: "var(--gb-warning)",
          danger: "var(--gb-danger)",
        },
      },
      fontFamily: {
        sans: ["var(--gb-font-sans)"],
        mono: ["var(--gb-font-mono)"],
      },
      fontSize: {
        xs: ["var(--gb-text-xs)", { lineHeight: "1.4" }],
        sm: ["var(--gb-text-sm)", { lineHeight: "1.4" }],
        base: ["var(--gb-text-base)", { lineHeight: "1.5" }],
        lg: ["var(--gb-text-lg)", { lineHeight: "1.35" }],
        xl: ["var(--gb-text-xl)", { lineHeight: "1.25" }],
        "2xl": ["var(--gb-text-2xl)", { lineHeight: "1.15" }],
        hero: ["var(--gb-text-hero)", { lineHeight: "1.08" }],
      },
      spacing: {
        1: "var(--gb-space-1)",
        2: "var(--gb-space-2)",
        3: "var(--gb-space-3)",
        4: "var(--gb-space-4)",
        6: "var(--gb-space-6)",
        8: "var(--gb-space-8)",
        12: "var(--gb-space-12)",
        16: "var(--gb-space-16)",
      },
      borderRadius: {
        sm: "var(--gb-radius-sm)",
        md: "var(--gb-radius-md)",
        lg: "var(--gb-radius-lg)",
        pill: "var(--gb-radius-pill)",
      },
      boxShadow: {
        sm: "var(--gb-shadow-sm)",
        md: "var(--gb-shadow-md)",
        lg: "var(--gb-shadow-lg)",
        "glow-ambient": "var(--gb-glow-ambient)",
        "glow-hardware": "var(--gb-glow-hardware)",
      },
    },
  },
};
