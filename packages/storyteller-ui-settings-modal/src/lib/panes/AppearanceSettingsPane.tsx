import { CheckIcon, MoonIcon, SunIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Label } from "@storyteller/ui-label";
import { useEffect, useState } from "react";

type AppTheme = "light" | "dark";

const THEME_STORAGE_KEY = "st-theme";

function getStoredTheme(): AppTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY)?.trim() === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  const toRemove: string[] = [];
  root.classList.forEach(c => {
    if (c.startsWith("theme-")) toRemove.push(c);
  });
  toRemove.forEach(c => root.classList.remove(c));
  root.classList.add(`theme-${theme}`);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Keep the selected mode for this session when storage is unavailable.
  }
}

const themes = [
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
] as const satisfies ReadonlyArray<{
  id: AppTheme;
  label: string;
  Icon: typeof SunIcon;
}>;

export const AppearanceSettingsPane = () => {
  const [selected, setSelected] = useState<AppTheme>(getStoredTheme());

  useEffect(() => {
    applyTheme(selected);
  }, [selected]);

  return (
    <div className="space-y-4 pt-3 text-base-fg">
      <div className="flex flex-col gap-1">
        <Label>Themes</Label>
        <p className="text-sm text-on-surface-variant">Choose a light or dark Aphrody M3 appearance.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {themes.map(t => {
          const isSelected = selected === t.id;
          const Icon = t.Icon;
          return (
            <button
              key={t.id}
              className={twMerge(
                "group flex min-h-12 items-center gap-3 rounded-medium border px-3 py-2 text-left transition-colors duration-150",
                isSelected
                  ? "border-primary bg-secondary-container text-on-secondary-container"
                  : "border-outline-variant bg-surface-container-low text-on-surface hover:border-outline hover:bg-surface-container-high",
              )}
              onClick={() => setSelected(t.id)}
              aria-pressed={isSelected}
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: "var(--md-sys-color-primary-container)",
                  color: "var(--md-sys-color-on-primary-container)",
                }}
              >
                <Icon className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium">{t.label}</span>
              {isSelected && <CheckIcon aria-hidden="true" className="size-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
