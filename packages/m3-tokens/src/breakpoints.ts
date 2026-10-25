/**
 * Material Design 3 adaptive layout tokens — window size classes & breakpoints.
 *
 * Canonical source of truth for the responsive system shared by `<md-scaffold>`
 * (web components) and `@aphrody/m3-react/adaptive` (React hooks). The
 * boundaries `600 / 840 / 1200 / 1600` dp are the official M3 window size class
 * breakpoints (m3.material.io — Foundations › Layout › Window size classes).
 */

/** M3 window size class, classifying a viewport **width** in dp/px. */
export type WindowSizeClass = "compact" | "medium" | "expanded" | "large" | "extra-large";

/** Lower-bound width (dp) of each window size class. */
export const BREAKPOINTS = {
  compact: 0,
  medium: 600,
  expanded: 840,
  large: 1200,
  "extra-large": 1600,
} as const satisfies Record<WindowSizeClass, number>;

/** Classes ordered smallest → largest. */
export const WINDOW_SIZE_CLASSES: readonly WindowSizeClass[] = [
  "compact",
  "medium",
  "expanded",
  "large",
  "extra-large",
];

/** Recommended navigation affordance per M3 adaptive guidance. */
/** Same names as `Navigation` in crates/aphrody-m3-tokens/src/adaptive.rs (Bar, RailCollapsed, RailExpanded). */
export type NavigationKind = "bar" | "rail-collapsed" | "rail-expanded";

/** M3 window height class, classifying a viewport **height** in dp/px. */
export type WindowHeightClass = "compact" | "medium" | "expanded";

/** Lower-bound height (dp) of each window height class: compact < 480, medium 480-899, expanded >= 900. */
export const HEIGHT_BREAKPOINTS = {
  compact: 0,
  medium: 480,
  expanded: 900,
} as const satisfies Record<WindowHeightClass, number>;

/** Height classes ordered smallest to largest. */
export const WINDOW_HEIGHT_CLASSES: readonly WindowHeightClass[] = ["compact", "medium", "expanded"];

/** Classify a height (dp/px) into its M3 window height class. */
export function classifyHeight(height: number): WindowHeightClass {
  if (height < HEIGHT_BREAKPOINTS.medium) return "compact";
  if (height < HEIGHT_BREAKPOINTS.expanded) return "medium";
  return "expanded";
}

/** `(min-height: …px)` media query for a height class's lower bound. */
export function heightMediaQuery(heightClass: WindowHeightClass): string {
  return `(min-height: ${HEIGHT_BREAKPOINTS[heightClass]}px)`;
}

/** Classify a width (dp/px) into its M3 window size class. */
export function classifyWidth(width: number): WindowSizeClass {
  if (width < BREAKPOINTS.medium) return "compact";
  if (width < BREAKPOINTS.expanded) return "medium";
  if (width < BREAKPOINTS.large) return "expanded";
  if (width < BREAKPOINTS["extra-large"]) return "large";
  return "extra-large";
}

/** `(min-width: …px)` media query for a size class's lower bound. */
export function mediaQuery(sizeClass: WindowSizeClass): string {
  return `(min-width: ${BREAKPOINTS[sizeClass]}px)`;
}

/** Window margin (dp) per M3: 16 in compact, 24 from medium up. */
export function marginFor(sizeClass: WindowSizeClass): number {
  return sizeClass === "compact" ? 16 : 24;
}

/** Recommended navigation component: bottom bar (compact), collapsed rail (medium/expanded), expanded rail (large+). */
export function navigationFor(sizeClass: WindowSizeClass): NavigationKind {
  if (sizeClass === "compact") return "bar";
  if (sizeClass === "medium" || sizeClass === "expanded") return "rail-collapsed";
  return "rail-expanded";
}

/** Canonical simultaneous pane count: 1 (compact/medium), 2 (expanded/large), 3 (extra-large). */
export function panesFor(sizeClass: WindowSizeClass): 1 | 2 | 3 {
  if (sizeClass === "compact" || sizeClass === "medium") return 1;
  if (sizeClass === "expanded" || sizeClass === "large") return 2;
  return 3;
}

/**
 * Emit CSS `@custom-media` rules + `:root` custom properties for the
 * breakpoints, so consumers can write responsive CSS against the canonical M3
 * values (`@media (--md-expanded) { … }`, `var(--md-breakpoint-large)`).
 */
export function breakpointsCss(): string {
  const customMedia = WINDOW_SIZE_CLASSES.filter(c => c !== "compact")
    .map(c => `@custom-media --md-${c} ${mediaQuery(c)};`)
    .join("\n");
  const vars = WINDOW_SIZE_CLASSES.map(c => `  --md-breakpoint-${c}: ${BREAKPOINTS[c]}px;`).join("\n");
  const heightMedia = WINDOW_HEIGHT_CLASSES.filter(c => c !== "compact")
    .map(c => `@custom-media --md-height-${c} ${heightMediaQuery(c)};`)
    .join("\n");
  const heightVars = WINDOW_HEIGHT_CLASSES.map(c => `  --md-breakpoint-height-${c}: ${HEIGHT_BREAKPOINTS[c]}px;`).join(
    "\n",
  );
  return `${customMedia}\n${heightMedia}\n\n:root {\n${vars}\n${heightVars}\n}\n`;
}
