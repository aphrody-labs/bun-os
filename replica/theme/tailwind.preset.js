// Bun OS Unified Tailwind Theme Preset (M3 Expressive × Aluminium OS × Android 17 × ChromiumOS)
module.exports = {
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "var(--md-sys-color-surface)",
          dim: "var(--md-sys-color-surface-dim)",
          bright: "var(--md-sys-color-surface-bright)",
          lowest: "var(--md-sys-color-surface-container-lowest)",
          low: "var(--md-sys-color-surface-container-low)",
          container: "var(--md-sys-color-surface-container)",
          high: "var(--md-sys-color-surface-container-high)",
          highest: "var(--md-sys-color-surface-container-highest)",
          variant: "var(--md-sys-color-surface-variant)",
        },
        onSurface: {
          DEFAULT: "var(--md-sys-color-on-surface)",
          variant: "var(--md-sys-color-on-surface-variant)",
        },
        primary: {
          DEFAULT: "var(--md-sys-color-primary)",
          on: "var(--md-sys-color-on-primary)",
          container: "var(--md-sys-color-primary-container)",
          onContainer: "var(--md-sys-color-on-primary-container)",
        },
        secondary: {
          DEFAULT: "var(--md-sys-color-secondary)",
          on: "var(--md-sys-color-on-secondary)",
          container: "var(--md-sys-color-secondary-container)",
          onContainer: "var(--md-sys-color-on-secondary-container)",
        },
        tertiary: {
          DEFAULT: "var(--md-sys-color-tertiary)",
          on: "var(--md-sys-color-on-tertiary)",
          container: "var(--md-sys-color-tertiary-container)",
          onContainer: "var(--md-sys-color-on-tertiary-container)",
        },
        outline: {
          DEFAULT: "var(--md-sys-color-outline)",
          variant: "var(--md-sys-color-outline-variant)",
        },
      },
      borderRadius: {
        "m3-xs": "4px",
        "m3-sm": "8px",
        "m3-md": "12px",
        "m3-lg": "16px",
        "m3-xl": "28px", // Android 17 & ChromiumOS pill shelf
        "m3-full": "9999px",
      },
      fontFamily: {
        sans: ["Google Sans", "Google Sans Text", "Inter", "sans-serif"],
        display: ["Google Sans Display", "Product Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "aluminium-dark": "var(--bunos-gradient-wallpaper)",
        "aluminium-light": "var(--bunos-gradient-light)",
        "gemini-glow": "var(--bunos-glowbar-radial)",
      },
    },
  },
};
