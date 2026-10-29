// SPDX-License-Identifier: Apache-2.0 OR MIT
// Tauri side of the theme contract: the three themes of `@aphrody/themes` (Material 3 "Google Book OS",
// Windows 11 Fluent UI, Apple iOS/macOS/Darwin) are mapped onto the native window effects that Tauri exposes.
import type { Effect, EffectState, Effects } from "@tauri-apps/api/window";

export type ThemeId = "material3" | "fluent" | "apple";
export type NativePlatform = "windows" | "macos" | "linux" | "other";
export type ColorScheme = "light" | "dark";

/** The subset of `Window` this bridge drives, so tests and non-Tauri hosts can supply their own. */
export interface ThemeWindow {
  setEffects(effects: Effects): Promise<void>;
  clearEffects(): Promise<void>;
  setTheme(theme: ColorScheme | null): Promise<void>;
}

export interface ApplyOptions {
  window?: ThemeWindow;
  platform?: NativePlatform;
  scheme?: ColorScheme;
  /** Document whose root receives `data-theme`, `data-native-effect` and the transparent background. */
  document?: Pick<Document, "documentElement">;
}

export interface AppliedTheme {
  theme: ThemeId;
  platform: NativePlatform;
  effects: string[];
  native: boolean;
}

// Effect values are the string enum of @tauri-apps/api/window; written as literals so no runtime import is needed.
const e = (name: string) => name as unknown as Effect;
const active = "followsWindowActiveState" as unknown as EffectState;

/** Windows 11: Fluent -> Mica, Material -> Acrylic, Apple -> Tabbed (Mica Alt, the closest to a sidebar sheet).
 * macOS: Fluent -> Titlebar, Material -> UnderWindowBackground, Apple -> Liquid Glass. */
export function effectsFor(theme: ThemeId, platform: NativePlatform): Effects | null {
  if (platform === "windows") {
    const effect = { fluent: "mica", material3: "acrylic", apple: "tabbed" }[theme];
    return { effects: [e(effect)], state: active, radius: theme === "apple" ? 12 : 8 };
  }
  if (platform === "macos") {
    const effect = { fluent: "titlebar", material3: "underWindowBackground", apple: "liquidGlassRegular" }[theme];
    return { effects: [e(effect)], state: active, radius: theme === "apple" ? 12 : 10 };
  }
  return null;
}

export function detectPlatform(userAgent: string = globalThis.navigator?.userAgent ?? ""): NativePlatform {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Mac OS X|Macintosh|Darwin/i.test(userAgent)) return "macos";
  if (/Linux|X11/i.test(userAgent)) return "linux";
  return "other";
}

export function detectScheme(): ColorScheme {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function currentWindow(): Promise<ThemeWindow> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

function isTauri(): boolean {
  return typeof (globalThis as { isTauri?: unknown }).isTauri !== "undefined" || "__TAURI_INTERNALS__" in globalThis;
}

/** Applies the native window effect of `theme` and makes the web content transparent so it shows through. */
export async function applyNativeTheme(theme: ThemeId, options: ApplyOptions = {}): Promise<AppliedTheme> {
  const platform = options.platform ?? detectPlatform();
  const scheme = options.scheme ?? detectScheme();
  const doc = options.document ?? (typeof document === "undefined" ? undefined : document);
  const root = doc?.documentElement;
  const effects = effectsFor(theme, platform);
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
    root.dataset.theme = theme;
    root.dataset.nativeEffect = native ? "true" : "false";
    root.style.colorScheme = scheme;
    root.style.background = native ? "transparent" : "";
  }
  return { theme, platform, effects: (effects?.effects ?? []) as unknown as string[], native };
}
