// SPDX-License-Identifier: Apache-2.0 OR MIT
import { applyNativeTheme, detectPlatform, isThemeId, type ThemeId } from "./index.ts";

/** `?skin=` > localStorage `aphrody-skin` > the platform's own window behaviour. */
export function pickTheme(
  search = globalThis.location?.search ?? "",
  stored = globalThis.localStorage?.getItem("aphrody-skin"),
): ThemeId {
  const fromUrl = new URLSearchParams(search).get("skin");
  if (isThemeId(fromUrl)) return fromUrl;
  if (isThemeId(stored)) return stored;
  const platform = detectPlatform();
  return platform === "windows" ? "fluent" : platform === "macos" ? "apple" : "m3";
}

/** Entry for apps whose frontend is not bundled with the bridge: applies the skin, re-applies it when the OS colour
 * scheme or transparency settings change, and exposes `window.aphrodySkin.set`. */
export async function boot(): Promise<void> {
  let current = pickTheme();
  await applyNativeTheme(current);
  for (const query of [
    "(prefers-color-scheme: dark)",
    "(prefers-reduced-transparency: reduce)",
    "(prefers-contrast: more)",
    "(forced-colors: active)",
  ]) {
    globalThis.matchMedia?.(query).addEventListener("change", () => void applyNativeTheme(current));
  }
  (globalThis as { aphrodySkin?: unknown }).aphrodySkin = {
    set: async (id: ThemeId) => {
      current = id;
      globalThis.localStorage?.setItem("aphrody-skin", id);
      return applyNativeTheme(id);
    },
  };
}

if (typeof document !== "undefined") void boot();
