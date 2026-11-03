// Colours are the M3 roles of the SpaceUI dark scheme (@aphrody/m3-theme/spaceui.css), copied into
// src/theme/m3-roles.json by scripts/m3-roles.ts. The SpaceUI aliases (accent, ink, app, sidebar, menu, status)
// map onto those roles exactly as the @theme block of spaceui.css does on the web; React Native has no
// color-mix(), so the hover/active state layers use the next surface-container tone.
const { dark: r } = require('./src/theme/m3-roles.json');

const kebab = (name) => name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
const roles = Object.fromEntries(Object.entries(r).map(([name, value]) => [kebab(name), value]));

/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./src/**/*.{ts,tsx}", "./index.js"],
	presets: [require("nativewind/preset")],
	theme: {
		extend: {
			colors: {
				...roles,
				accent: { DEFAULT: r.primary, faint: r.primary, deep: r.primaryContainer },
				ink: { DEFAULT: r.onSurface, dull: r.onSurfaceVariant, faint: r.outline },
				app: {
					DEFAULT: r.surface,
					box: r.surfaceContainer,
					'dark-box': r.surfaceContainerLow,
					'darker-box': r.surfaceContainerLowest,
					'light-box': r.surfaceContainerHighest,
					overlay: r.surfaceContainerHigh,
					input: r.surfaceContainerHighest,
					focus: r.surfaceContainerLowest,
					line: r.outlineVariant,
					divider: r.outlineVariant,
					button: r.surfaceContainerHigh,
					hover: r.surfaceContainerHigh,
					selected: r.secondaryContainer,
					'selected-item': r.surfaceContainerHigh,
					active: r.surfaceContainerHighest,
					shade: r.shadow,
					frame: r.outlineVariant,
					slider: r.surfaceContainerHighest,
					'explorer-scrollbar': r.outlineVariant,
				},
				sidebar: {
					DEFAULT: r.surfaceContainerLow,
					box: r.surfaceContainer,
					line: r.outlineVariant,
					ink: r.onSurface,
					'ink-dull': r.onSurfaceVariant,
					'ink-faint': r.outline,
					divider: r.outlineVariant,
					button: r.surfaceContainerHigh,
					selected: r.secondaryContainer,
					shade: r.shadow,
				},
				menu: {
					DEFAULT: r.surfaceContainer,
					line: r.outlineVariant,
					ink: r.onSurface,
					faint: r.onSurfaceVariant,
					hover: r.surfaceContainerHigh,
					selected: r.secondaryContainer,
					shade: r.shadow,
				},
				status: { success: r.success, warning: r.warning, error: r.error, info: r.primary },
			},
			fontSize: {
				md: "16px",
			},
		},
	},
	plugins: [],
};
