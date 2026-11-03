/**
 * Language Settings Component
 *
 * Allows users to select the application display language.
 */

import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import { supportedLanguages, loadLanguage, resolveLanguage } from "../../i18n";
import { GlobeIcon, ExternalLinkIcon } from "../icons";
import { debug } from "../../utils/logger";

export function LanguageSettings() {
  const { t, i18n } = useTranslation("settings");
  const { settings, updateSetting } = useSettingsStore();

  if (!settings) return null;

  const currentLocale = settings.locale || "auto";

  const handleLanguageChange = async (locale: string) => {
    const targetLang = locale === "auto"
      ? resolveLanguage(navigator.language || "en")
      : locale;
    debug(`[LanguageSettings] Language changed: locale=${locale}, targetLang=${targetLang}`);
    await updateSetting("locale", locale);

    // Sync to localStorage so i18next LanguageDetector restores the correct
    // language on next startup (before Tauri settings are loaded asynchronously)
    localStorage.setItem("bunos-wsl-language", targetLang);

    await loadLanguage(targetLang);
    i18n.changeLanguage(targetLang);

    // Set RTL direction for Arabic
    const langConfig = supportedLanguages.find((l) => l.code === (locale === "auto" ? i18n.language : locale));
    document.documentElement.dir = langConfig && "dir" in langConfig && langConfig.dir === "rtl" ? "rtl" : "ltr";
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <GlobeIcon size="md" className="text-on-primary-container" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-on-surface">{t("language.title")}</h2>
              <p className="text-sm text-on-surface-variant">{t("language.description")}</p>
            </div>
          </div>

          <div className="space-y-2">
            {/* Auto-detect option */}
            <label
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                currentLocale === "auto"
                  ? "border-primary bg-primary/10"
                  : "border-outline-variant hover:border-outline-variant"
              }`}
            >
              <input
                type="radio"
                name="language"
                value="auto"
                checked={currentLocale === "auto"}
                onChange={() => handleLanguageChange("auto")}
                className="accent-primary"
              />
              <div>
                <span className="text-sm font-medium text-on-surface">
                  {t("language.auto")}
                </span>
                <p className="text-xs text-on-surface-variant">
                  {t("language.autoDesc")}
                </p>
              </div>
            </label>

            {/* Language options */}
            {supportedLanguages.map((lang) => (
              <label
                key={lang.code}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  currentLocale === lang.code
                    ? "border-primary bg-primary/10"
                    : "border-outline-variant hover:border-outline-variant"
                }`}
              >
                <input
                  type="radio"
                  name="language"
                  value={lang.code}
                  checked={currentLocale === lang.code}
                  onChange={() => handleLanguageChange(lang.code)}
                  className="accent-primary"
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-on-surface">
                    {lang.nativeName}
                  </span>
                  {lang.code !== "en" && (
                    <span className="text-xs text-on-surface-variant">
                      ({lang.name})
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-outline-variant/50">
            <a
              href="https://github.com/aphrody-labs/bun-os/issues/new?template=language-request.yml"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-primary transition-colors"
            >
              <span>{t("language.requestLanguage")}</span>
              <span className="underline">{t("language.requestLanguageLink")}</span>
              <ExternalLinkIcon size="sm" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
