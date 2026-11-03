// SPDX-License-Identifier: Apache-2.0 OR MIT
// Tauri window effects for the Bun OS design system (docs/DESIGN-SYSTEM.md). Every skin paints the same Material 3
// roles from @aphrody/m3-tokens; a skin only picks the native window material (window-effects.json) and a shape
// preset on the M3 corner scale. No colour is defined here.
import type { Effect, EffectState, Effects } from "@tauri-apps/api/window";
import windowEffects from "./window-effects.json" with { type: "json" };

/** `m3` is the Bun OS default; `fluent` and `apple` are Windows 11 and macOS 26 window behaviours on M3 roles. */
export type ThemeId = "m3" | "fluent" | "apple";
export type NativePlatform = "windows" | "macos" | "linux" | "other";
export type ColorScheme = "light" | "dark";

export const THEME_IDS: readonly ThemeId[] = ["m3", "fluent", "apple"];
export const isThemeId = (value: unknown): value is ThemeId => THEME_IDS.includes(value as ThemeId);

/** The subset of `Window` this bridge drives, so tests and non-Tauri hosts can supply their own. */
export interface ThemeWindow {
  setEffects(effects: Effects): Promise<void>;
  clearEffects(): Promise<void>;
  setTheme(theme: ColorScheme | null): Promise<void>;
}

type Root = Pick<HTMLElement, "dataset"> & { style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> };

export interface ApplyOptions {
  window?: ThemeWindow;
  platform?: NativePlatform;
  scheme?: ColorScheme;
  /** True when the OS asks for opaque surfaces (reduced transparency, increased contrast, forced colours). */
  opaque?: boolean;
  /** Document whose root receives `data-skin`, `data-native-effect`, the shape preset and the transparent background. */
  document?: { documentElement: Root };
}

export interface AppliedTheme {
  theme: ThemeId;
  platform: NativePlatform;
  effects: string[];
  native: boolean;
}

interface EffectEntry {
  effects: string[];
  transparent: boolean;
  radius?: number;
  state?: string;
}

const table = windowEffects as unknown as Record<ThemeId, Record<"windows" | "macos" | "other", EffectEntry>>;

/** Shape presets on the M3 corner scale (`--md-sys-shape-corner-*`, px). `m3` keeps the generated sheet values.
 * Fluent: 4px controls, 8px overlays and windows. Apple glass: every corner one step up the M3 Expressive scale. */
export const SHAPE_PRESETS: Record<ThemeId, Partial<Record<string, string>>> = {
  m3: {},
  fluent: {
    "extra-small": "4px",
    small: "4px",
    medium: "4px",
    large: "8px",
    "large-increased": "8px",
    "extra-large": "8px",
    "extra-large-increased": "8px",
    "extra-extra-large": "8px",
  },
  apple: {
    "extra-small": "8px",
    small: "12px",
    medium: "16px",
    large: "20px",
    "large-increased": "28px",
    "extra-large": "32px",
    "extra-large-increased": "48px",
  },
};

const CORNERS = [
  "extra-small",
  "small",
  "medium",
  "large",
  "large-increased",
  "extra-large",
  "extra-large-increased",
  "extra-extra-large",
] as const;

// Effect values are the string enum of @tauri-apps/api/window; written as literals so no runtime import is needed.
const effectList = (names: string[]) => names as unknown as Effect[];

/** The native effect of `theme` on `platform`, or null when the window stays opaque. */
export function effectsFor(theme: ThemeId, platform: NativePlatform): Effects | null {
  const entry = table[theme][platform === "linux" ? "other" : platform];
  if (!entry.effects.length) return null;
  return {
    effects: effectList(entry.effects),
    ...(entry.state ? { state: entry.state as unknown as EffectState } : {}),
    ...(entry.radius === undefined ? {} : { radius: entry.radius }),
  };
}

export function detectPlatform(userAgent: string = globalThis.navigator?.userAgent ?? ""): NativePlatform {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Mac OS X|Macintosh|Darwin/i.test(userAgent)) return "macos";
  if (/Linux|X11/i.test(userAgent)) return "linux";
  return "other";
}

const media = (query: string) => globalThis.matchMedia?.(query).matches ?? false;

export function detectScheme(): ColorScheme {
  return media("(prefers-color-scheme: dark)") ? "dark" : "light";
}

/** Mandatory material fallback of the design system: no translucency under these OS settings. */
export function detectOpaque(): boolean {
  return (
    media("(prefers-reduced-transparency: reduce)") ||
    media("(prefers-contrast: more)") ||
    media("(forced-colors: active)")
  );
}

async function currentWindow(): Promise<ThemeWindow> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

function isTauri(): boolean {
  return typeof (globalThis as { isTauri?: unknown }).isTauri !== "undefined" || "__TAURI_INTERNALS__" in globalThis;
}

/** Applies the native window effect and shape preset of `theme`; the web content shows through only when a native
 * material is active. */
export async function applyNativeTheme(theme: ThemeId, options: ApplyOptions = {}): Promise<AppliedTheme> {
  const platform = options.platform ?? detectPlatform();
  const scheme = options.scheme ?? detectScheme();
  const opaque = options.opaque ?? detectOpaque();
  const root = (options.document ?? (typeof document === "undefined" ? undefined : document))?.documentElement;
  const effects = opaque ? null : effectsFor(theme, platform);
  let native = false;
  const win = options.window ?? (isTauri() ? await currentWindow() : undefined);
  if (win) {
    await win.setTheme(scheme);
    if (effects) {
      await win.setEffects(effects);
      native = true;
    } else {
      await win.clearEffects();
    }
  }
  if (root) {
    root.dataset.skin = theme;
    root.dataset.nativeEffect = native ? "true" : "false";
    root.style.setProperty("color-scheme", scheme);
    if (native) root.style.setProperty("background", "transparent");
    else root.style.removeProperty("background");
    const preset = SHAPE_PRESETS[theme];
    for (const corner of CORNERS) {
      const value = preset[corner];
      if (value) root.style.setProperty(`--md-sys-shape-corner-${corner}`, value);
      else root.style.removeProperty(`--md-sys-shape-corner-${corner}`);
    }
  }
  return { theme, platform, effects: (effects?.effects ?? []) as unknown as string[], native };
}
