// SPDX-License-Identifier: Apache-2.0 OR MIT
import { applyNativeTheme, detectPlatform, type ThemeId } from "./index.ts";

const ids: readonly ThemeId[] = ["material3", "fluent", "apple"];
const isThemeId = (value: unknown): value is ThemeId => ids.includes(value as ThemeId);

/** `?theme=` > localStorage `aphrody-theme` > the platform's own design language. */
export function pickTheme(search = globalThis.location?.search ?? "", stored = globalThis.localStorage?.getItem("aphrody-theme")): ThemeId {
  const fromUrl = new URLSearchParams(search).get("theme");
  if (isThemeId(fromUrl)) return fromUrl;
  if (isThemeId(stored)) return stored;
  const platform = detectPlatform();
  return platform === "windows" ? "fluent" : platform === "macos" ? "apple" : "material3";
}

/** Entry for apps whose frontend is not bundled with the bridge: sets the theme and exposes `window.aphrodyTheme.set`. */
export async function boot(): Promise<void> {
  await applyNativeTheme(pickTheme());
  (globalThis as { aphrodyTheme?: unknown }).aphrodyTheme = {
    set: async (id: ThemeId) => {
      globalThis.localStorage?.setItem("aphrody-theme", id);
      return applyNativeTheme(id);
    },
  };
}

if (typeof document !== "undefined") void boot();
