// Light/dark mode of the ArtCraft shell. The M3 scheme is generated for both
// modes from one seed; the user picks light, dark or the OS setting (default).
export type AppThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "st-theme";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function readThemePreference(): AppThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)?.trim();
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function applyResolvedTheme(preference: AppThemePreference) {
  const dark = preference === "system" ? darkQuery().matches : preference === "dark";
  const root = document.documentElement;
  for (let index = root.classList.length - 1; index >= 0; index--) {
    const themeClass = root.classList.item(index);
    if (themeClass?.startsWith("theme-")) root.classList.remove(themeClass);
  }
  root.classList.add(dark ? "theme-dark" : "theme-light");
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
}

export function setThemePreference(preference: AppThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Keep the selected mode for this session when storage is unavailable.
  }
  applyResolvedTheme(preference);
}

/** Applies the stored preference and keeps following the OS while it is "system". */
export function startAppTheme() {
  applyResolvedTheme(readThemePreference());
  darkQuery().addEventListener("change", () => {
    if (readThemePreference() === "system") applyResolvedTheme("system");
  });
}
