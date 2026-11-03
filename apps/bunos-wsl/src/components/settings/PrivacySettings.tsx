/**
 * Privacy Settings Component
 *
 * Allows users to control telemetry and data sharing preferences.
 */

import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import { Toggle } from "./FormControls";
import { ChartBarIcon, ShieldCheckIcon } from "../icons";

export function PrivacySettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSetting } = useSettingsStore();

  if (!settings) return null;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center shadow-lg">
              <ChartBarIcon size="md" className="text-on-primary-container" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-on-surface">{t('privacy.title')}</h2>
              <p className="text-sm text-on-surface-variant">{t('privacy.description')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <Toggle
              label={t('privacy.telemetryEnabled')}
              description={t('privacy.telemetryEnabledDesc')}
              checked={settings.telemetryEnabled}
              onChange={(checked) => updateSetting("telemetryEnabled", checked)}
            />

            {/* Info box about what's collected */}
            <div className="p-4 bg-surface-container border border-outline-variant rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheckIcon size="sm" className="text-success" />
                <span className="text-sm font-medium text-on-surface">
                  {t('privacy.privacyFocused')}
                </span>
              </div>
              <p className="text-sm text-on-surface-variant mb-3">
                {t('privacy.whenEnabled')}
              </p>
              <ul className="text-sm text-on-surface-variant space-y-1 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{t('privacy.collectItem1')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{t('privacy.collectItem2')}</span>
                </li>
              </ul>
              <div className="mt-3 pt-3 border-t border-outline-variant">
                <p className="text-xs text-on-surface-variant">
                  {t('privacy.neverCollect')}{" "}
                  {t('privacy.providerPrefix')}
                  <a
                    href="https://aptabase.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {t('privacy.providerLinkText')}
                  </a>
                  {t('privacy.providerSuffix')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
