/**
 * Theme Settings Component
 *
 * Light/dark mode, a built-in seed or a custom seed with its scheme variant and contrast level.
 * Every colour shown in the UI is derived from the chosen seed by the Material 3 engine.
 */

import { useTranslation } from "react-i18next";
import { CONTRAST_LEVELS, CUSTOM_VARIANTS, useTheme } from "../../themes";
import type { ThemeId, ThemeMode } from "../../themes";
import { PaletteIcon, CheckIcon, ResetIcon } from "../icons";

const MODES: readonly ThemeMode[] = ["system", "light", "dark"];

function optionClass(selected: boolean): string {
  return `px-3 py-2 text-sm rounded-lg border transition-colors ${
    selected
      ? "border-primary bg-secondary-container text-on-secondary-container"
      : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8"
  }`;
}

export function ThemeSettings() {
  const { t } = useTranslation("settings");
  const { themeId, setTheme, mode, setMode, availableThemes, customSeed, updateCustomSeed, resetCustomSeed, schemeError } =
    useTheme();

  return (
    <div className="space-y-8">
      <section className="bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
            <PaletteIcon size="md" className="text-on-primary-container" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-on-surface">{t("theme.title")}</h2>
            <p className="text-sm text-on-surface-variant">{t("theme.description")}</p>
          </div>
        </div>

        {/* Light / dark */}
        <div className="mb-6" role="radiogroup" aria-label={t("theme.mode.title")}>
          <div className="text-sm font-medium text-on-surface mb-2">{t("theme.mode.title")}</div>
          <div className="flex gap-2">
            {MODES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                data-testid={`theme-mode-${option}`}
                onClick={() => setMode(option)}
                className={optionClass(mode === option)}
              >
                {t(`theme.mode.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Seeds */}
        <div className="grid grid-cols-2 gap-3">
          {availableThemes.map((theme) => {
            const isSelected = themeId === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setTheme(theme.id as ThemeId)}
                data-testid={`theme-${theme.id}`}
                aria-pressed={isSelected}
                className={`relative p-4 rounded-lg border-2 transition-colors text-left ${
                  isSelected
                    ? "border-primary bg-secondary-container"
                    : "border-outline-variant hover:border-outline bg-surface-container"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <CheckIcon size="sm" className="text-on-primary w-3 h-3" />
                  </div>
                )}

                <div className="flex items-center gap-3">
                  {/* The seed itself: a colour swatch (content), not a UI role. */}
                  <span
                    className="w-8 h-8 rounded-full border border-outline-variant shrink-0"
                    style={{ backgroundColor: theme.seed }}
                    aria-hidden="true"
                  />
                  <div>
                    <div
                      className={`font-medium text-sm ${isSelected ? "text-on-secondary-container" : "text-on-surface"}`}
                    >
                      {theme.id === "custom" ? t("theme.customTheme") : theme.name}
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${isSelected ? "text-on-secondary-container" : "text-on-surface-variant"}`}
                    >
                      {t(`theme.builtIn.${theme.id}`, theme.description)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {schemeError && (
          <p role="alert" className="mt-4 text-sm text-error">
            {t("theme.schemeError", { error: schemeError })}
          </p>
        )}
      </section>

      {/* Custom seed */}
      {themeId === "custom" && (
        <section className="bg-surface-container-low border border-outline-variant rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-tertiary-container flex items-center justify-center">
                <PaletteIcon size="md" className="text-on-tertiary-container" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-on-surface">{t("theme.customTheme")}</h2>
                <p className="text-sm text-on-surface-variant">{t("theme.customSeedDesc")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={resetCustomSeed}
              className="flex items-center gap-2 px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg transition-colors"
            >
              <ResetIcon size="sm" />
              {t("theme.resetToDefault")}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="theme-custom-seed" className="flex-1 text-sm text-on-surface">
              {t("theme.seed")}
            </label>
            <input
              id="theme-custom-seed"
              type="color"
              value={customSeed.seed}
              onChange={(event) => updateCustomSeed({ seed: event.target.value })}
              data-testid="theme-custom-seed"
              className="w-10 h-10 rounded-sm cursor-pointer border border-outline-variant bg-transparent"
            />
            <span className="w-20 text-xs font-mono text-on-surface-variant">{customSeed.seed}</span>
          </div>

          <div role="radiogroup" aria-label={t("theme.variant")}>
            <div className="text-sm text-on-surface mb-2">{t("theme.variant")}</div>
            <div className="flex flex-wrap gap-2">
              {CUSTOM_VARIANTS.map((variant) => (
                <button
                  key={variant}
                  type="button"
                  role="radio"
                  aria-checked={customSeed.variant === variant}
                  onClick={() => updateCustomSeed({ variant })}
                  className={optionClass(customSeed.variant === variant)}
                >
                  {t(`theme.variants.${variant}`)}
                </button>
              ))}
            </div>
          </div>

          <div role="radiogroup" aria-label={t("theme.contrast")}>
            <div className="text-sm text-on-surface mb-2">{t("theme.contrast")}</div>
            <div className="flex gap-2">
              {CONTRAST_LEVELS.map(({ id, level }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={customSeed.contrastLevel === level}
                  onClick={() => updateCustomSeed({ contrastLevel: level })}
                  className={optionClass(customSeed.contrastLevel === level)}
                >
                  {t(`theme.contrastLevels.${id}`)}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-on-surface-variant">{t("theme.tip")}</p>
        </section>
      )}
    </div>
  );
}
