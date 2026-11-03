import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Label } from "@storyteller/ui-label";
import { useState } from "react";
import { readThemePreference, setThemePreference, type AppThemePreference } from "../app-theme";

const themes = [
  { id: "system", label: "System", Icon: MonitorIcon },
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
] as const satisfies ReadonlyArray<{
  id: AppThemePreference;
  label: string;
  Icon: typeof SunIcon;
}>;

export const AppearanceSettingsPane = () => {
  const [selected, setSelected] = useState<AppThemePreference>(readThemePreference);
  const select = (theme: AppThemePreference) => {
    setThemePreference(theme);
    setSelected(theme);
  };

  return (
    <div className="space-y-4 pt-3 text-base-fg">
      <div className="flex flex-col gap-1">
        <Label>Themes</Label>
        <p className="text-sm text-on-surface-variant">
          Follow the system setting, or choose a light or dark Aphrody M3 appearance.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {themes.map(t => {
          const isSelected = selected === t.id;
          const Icon = t.Icon;
          return (
            <button
              key={t.id}
              className={twMerge(
                "group flex min-h-12 items-center gap-3 rounded-[var(--md-sys-shape-corner-medium)] border px-3 py-2 text-left transition-colors duration-150",
                isSelected
                  ? "border-primary bg-secondary-container text-on-secondary-container"
                  : "border-outline-variant bg-surface-container-low text-on-surface hover:border-outline hover:bg-surface-container-high",
              )}
              onClick={() => select(t.id)}
              aria-pressed={isSelected}
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container"
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
