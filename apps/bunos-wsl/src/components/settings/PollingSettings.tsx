/**
 * Polling Settings Component
 *
 * Allows users to configure automatic refresh intervals and enable/disable polling.
 */

import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import { usePollingStore } from "../../store/pollingStore";
import { RefreshIcon, WarningIcon } from "../icons";
import { Toggle, SettingSelect } from "./FormControls";
import { DEFAULT_POLLING_INTERVALS } from "../../types/polling";

// Interval options in seconds
const INTERVAL_OPTION_KEYS = [
  { value: 5000, labelKey: "polling.intervals.5seconds" },
  { value: 10000, labelKey: "polling.intervals.10seconds" },
  { value: 15000, labelKey: "polling.intervals.15seconds" },
  { value: 30000, labelKey: "polling.intervals.30seconds" },
  { value: 60000, labelKey: "polling.intervals.1minute" },
  { value: 120000, labelKey: "polling.intervals.2minutes" },
];


export function PollingSettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSetting } = useSettingsStore();
  const { polls, hasBackoff, resetAllBackoff } = usePollingStore();

  const intervalOptions = INTERVAL_OPTION_KEYS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));

  const isBackedOff = hasBackoff();

  const handlePollingEnabledChange = (enabled: boolean) => {
    updateSetting("pollingEnabled", enabled);
  };

  const handleIntervalChange = (key: keyof typeof settings.pollingIntervals, value: number) => {
    updateSetting("pollingIntervals", {
      ...settings.pollingIntervals,
      [key]: value,
    });
  };

  const handleResetDefaults = () => {
    updateSetting("pollingIntervals", DEFAULT_POLLING_INTERVALS);
  };

  return (
    <div className="space-y-8">
      {/* Polling Section Header */}
      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center shadow-lg">
              <RefreshIcon size="md" className="text-on-primary-container" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-on-surface">{t('polling.title')}</h2>
              <p className="text-sm text-on-surface-variant">{t('polling.description')}</p>
            </div>
          </div>

          {/* Backoff Warning */}
          {isBackedOff && (
            <div className="mb-6 p-4 bg-warning/15 border border-warning/30 rounded-lg">
              <div className="flex items-start gap-3">
                <WarningIcon size="md" className="text-warning mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-warning">{t('polling.backoffWarning')}</p>
                  <p className="text-xs text-warning/80 mt-1">
                    {t('polling.backoffDesc')}
                  </p>
                  <button
                    onClick={resetAllBackoff}
                    className="mt-2 text-xs text-warning hover:text-warning/90 underline"
                  >
                    {t('polling.resetBackoff')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Enable/Disable Toggle */}
          <div className="mb-6 pb-6 border-b border-outline-variant/50">
            <Toggle
              label={t('polling.enabled')}
              description={t('polling.enabledDesc')}
              checked={settings.pollingEnabled}
              onChange={handlePollingEnabledChange}
            />
          </div>

          {/* Interval Settings */}
          <div className="space-y-1">
            <SettingSelect
              label={t('polling.distros')}
              description={t('polling.distrosDesc')}
              value={settings.pollingIntervals.distros}
              options={intervalOptions}
              onChange={(v) => handleIntervalChange("distros", v as number)}
              disabled={!settings.pollingEnabled}
              testId="polling-interval-distros"
            />

            <SettingSelect
              label={t('polling.resources')}
              description={t('polling.resourcesDesc')}
              value={settings.pollingIntervals.resources}
              options={intervalOptions}
              onChange={(v) => handleIntervalChange("resources", v as number)}
              disabled={!settings.pollingEnabled}
              testId="polling-interval-resources"
            />

            <SettingSelect
              label={t('polling.health')}
              description={t('polling.healthDesc')}
              value={settings.pollingIntervals.health}
              options={intervalOptions}
              onChange={(v) => handleIntervalChange("health", v as number)}
              disabled={!settings.pollingEnabled}
              testId="polling-interval-health"
            />
          </div>

          {/* Current Status */}
          <div className="mt-6 pt-6 border-t border-outline-variant/50">
            <p className="text-xs text-on-surface-variant mb-3">{t('polling.currentStatus')}</p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-2 bg-surface-container/50 rounded-md">
                <div className="text-on-surface-variant">{t('polling.distros')}</div>
                <div className="text-on-surface font-mono">
                  {polls.distros.consecutiveTimeouts > 0 ? (
                    <span className="text-warning">
                      {t('polling.backedOff', { interval: Math.round(polls.distros.currentInterval / 1000) })}
                    </span>
                  ) : (
                    `${Math.round(polls.distros.currentInterval / 1000)}s`
                  )}
                </div>
              </div>
              <div className="p-2 bg-surface-container/50 rounded-md">
                <div className="text-on-surface-variant">{t('polling.resources')}</div>
                <div className="text-on-surface font-mono">
                  {polls.resources.consecutiveTimeouts > 0 ? (
                    <span className="text-warning">
                      {t('polling.backedOff', { interval: Math.round(polls.resources.currentInterval / 1000) })}
                    </span>
                  ) : (
                    `${Math.round(polls.resources.currentInterval / 1000)}s`
                  )}
                </div>
              </div>
              <div className="p-2 bg-surface-container/50 rounded-md">
                <div className="text-on-surface-variant">{t('polling.health')}</div>
                <div className="text-on-surface font-mono">
                  {polls.health.consecutiveTimeouts > 0 ? (
                    <span className="text-warning">
                      {t('polling.backedOff', { interval: Math.round(polls.health.currentInterval / 1000) })}
                    </span>
                  ) : (
                    `${Math.round(polls.health.currentInterval / 1000)}s`
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Reset to Defaults */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetDefaults}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {t('polling.resetDefaults')}
            </button>
          </div>

          <p className="mt-4 text-xs text-on-surface-variant">
            {t('polling.tip')}
          </p>
        </div>
      </section>
    </div>
  );
}
