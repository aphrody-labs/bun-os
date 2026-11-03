/**
 * Built-in Themes
 *
 * Each theme is a seed handed to the canonical Material 3 engine. "Bun OS" uses the product seed
 * from @aphrody/identity; High Contrast is the same seed at contrast level 1.0.
 */

import { PET_COLORS } from "@aphrody/identity/pet";
import type { BuiltInThemeId, SchemeSeed, SchemeVariant, Theme } from "./types";

// design:content: seed colours handed to the M3 engine (user-selectable inputs, not UI roles).
const SEEDS: Record<Exclude<BuiltInThemeId, "bun-os" | "high-contrast">, string> = {
  "mission-control": "#00f0ff",
  obsidian: "#f59e0b",
  cobalt: "#0050a0",
  "slate-dusk": "#a78bfa",
  "forest-mist": "#6f8f5f",
  "rose-quartz": "#f472b6",
  "ocean-fog": "#2dd4bf",
};

export const BUILT_IN_THEMES: readonly Theme[] = [
  {
    id: "bun-os",
    name: "Bun OS",
    description: "The Bun OS product colour",
    seed: PET_COLORS.seed,
    variant: "tonal-spot",
    contrastLevel: 0,
  },
  {
    id: "mission-control",
    name: "Mission Control",
    description: "Vivid cyan",
    seed: SEEDS["mission-control"],
    variant: "vibrant",
    contrastLevel: 0,
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Warm stone and orange tones",
    seed: SEEDS.obsidian,
    variant: "tonal-spot",
    contrastLevel: 0,
  },
  {
    id: "cobalt",
    name: "Cobalt",
    description: "Deep blue with golden accents",
    seed: SEEDS.cobalt,
    variant: "expressive",
    contrastLevel: 0,
  },
  {
    id: "slate-dusk",
    name: "Slate Dusk",
    description: "Twilight blue-gray with violet accents",
    seed: SEEDS["slate-dusk"],
    variant: "tonal-spot",
    contrastLevel: 0,
  },
  {
    id: "forest-mist",
    name: "Forest Mist",
    description: "Earthy sage with warm amber highlights",
    seed: SEEDS["forest-mist"],
    variant: "tonal-spot",
    contrastLevel: 0,
  },
  {
    id: "rose-quartz",
    name: "Rose Quartz",
    description: "Soft mauve with dusty rose accents",
    seed: SEEDS["rose-quartz"],
    variant: "tonal-spot",
    contrastLevel: 0,
  },
  {
    id: "ocean-fog",
    name: "Ocean Fog",
    description: "Coastal blue-gray with teal sea foam",
    seed: SEEDS["ocean-fog"],
    variant: "tonal-spot",
    contrastLevel: 0,
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    description: "Maximum contrast for accessibility",
    seed: PET_COLORS.seed,
    variant: "tonal-spot",
    contrastLevel: 1,
  },
];

/** Variants offered for a custom seed. */
export const CUSTOM_VARIANTS: readonly SchemeVariant[] = ["tonal-spot", "vibrant", "expressive", "neutral", "monochrome"];

/** Contrast levels offered for a custom seed (M3 standard, medium and high). */
export const CONTRAST_LEVELS = [
  { id: "standard", level: 0 },
  { id: "medium", level: 0.5 },
  { id: "high", level: 1 },
] as const;

export function getDefaultTheme(): Theme {
  return BUILT_IN_THEMES[0];
}

export function getThemeById(id: string): Theme | undefined {
  return BUILT_IN_THEMES.find((theme) => theme.id === id);
}

/** The custom theme starts from the product seed. */
export const DEFAULT_CUSTOM_SEED: SchemeSeed = {
  seed: PET_COLORS.seed,
  variant: "tonal-spot",
  contrastLevel: 0,
};
