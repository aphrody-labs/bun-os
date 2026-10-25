/** Canonical ownership map for every Aphrody M3 UI surface. */
export const M3_UI_CATALOG = Object.freeze({
  tokens: "@aphrody/m3-tokens",
  theme: "@aphrody/m3-theme",
  webComponents: "@aphrody/material-web",
  react: "@aphrody/m3-react",
  primitives: "@aphrody/m3-primitives",
  forms: "@aphrody/m3-forms",
  ai: "@aphrody/m3-ai",
  explorer: "@aphrody/m3-explorer",
  reader: "@aphrody/m3-reader",
  icons: "crates/ui/bun/icons/material-symbols",
  native: "crates/aphrody-m3-tokens",
  shell: "crates/aphrody-app",
  showcase: "examples/m3-spaceui-showcase",
} as const);

export type M3UiLayer = keyof typeof M3_UI_CATALOG;

export function resolveM3Layer(layer: M3UiLayer): string {
  return M3_UI_CATALOG[layer];
}
