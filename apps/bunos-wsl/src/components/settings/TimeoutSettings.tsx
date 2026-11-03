/**
 * Timeout Settings Component
 *
 * Allows users to configure WSL command timeout values.
 */

import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import { ClockIcon } from "../icons";
import { DEFAULT_WSL_TIMEOUTS } from "../../types/settings";
import { SettingSelect } from "./FormControls";

// Timeout options in seconds
const QUICK_TIMEOUT_OPTION_KEYS = [
  { value: 5, labelKey: "timeouts.intervals.5seconds" },
  { value: 10, labelKey: "timeouts.intervals.10seconds" },
  { value: 15, labelKey: "timeouts.intervals.15seconds" },
  { value: 30, labelKey: "timeouts.intervals.30seconds" },
];

const DEFAULT_TIMEOUT_OPTION_KEYS = [
  { value: 15, labelKey: "timeouts.intervals.15seconds" },
  { value: 30, labelKey: "timeouts.intervals.30seconds" },
  { value: 60, labelKey: "timeouts.intervals.1minute" },
  { value: 120, labelKey: "timeouts.intervals.2minutes" },
];

const LONG_TIMEOUT_OPTION_KEYS = [
  { value: 300, labelKey: "timeouts.intervals.5minutes" },
  { value: 600, labelKey: "timeouts.intervals.10minutes" },
  { value: 900, labelKey: "timeouts.intervals.15minutes" },
  { value: 1200, labelKey: "timeouts.intervals.20minutes" },
  { value: 1800, labelKey: "timeouts.intervals.30minutes" },
];

const SHELL_TIMEOUT_OPTION_KEYS = [
  { value: 15, labelKey: "timeouts.intervals.15seconds" },
  { value: 30, labelKey: "timeouts.intervals.30seconds" },
  { value: 60, labelKey: "timeouts.intervals.1minute" },
  { value: 120, labelKey: "timeouts.intervals.2minutes" },
  { value: 300, labelKey: "timeouts.intervals.5minutes" },
];

const SUDO_TIMEOUT_OPTION_KEYS = [
  { value: 60, labelKey: "timeouts.intervals.1minute" },
  { value: 120, labelKey: "timeouts.intervals.2minutes" },
  { value: 180, labelKey: "timeouts.intervals.3minutes" },
  { value: 300, labelKey: "timeouts.intervals.5minutes" },
];


function resolveOptions(
  keys: { value: number; labelKey: string }[],
  t: (key: string) => string,
): { value: number; label: string }[] {
  return keys.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));
}

export function TimeoutSettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSetting } = useSettingsStore();

  const quickTimeoutOptions = resolveOptions(QUICK_TIMEOUT_OPTION_KEYS, t);
  const defaultTimeoutOptions = resolveOptions(DEFAULT_TIMEOUT_OPTION_KEYS, t);
  const longTimeoutOptions = resolveOptions(LONG_TIMEOUT_OPTION_KEYS, t);
  const shellTimeoutOptions = resolveOptions(SHELL_TIMEOUT_OPTION_KEYS, t);
  const sudoTimeoutOptions = resolveOptions(SUDO_TIMEOUT_OPTION_KEYS, t);

  const handleTimeoutChange = (key: keyof typeof settings.wslTimeouts, value: number) => {
    updateSetting("wslTimeouts", {
      ...settings.wslTimeouts,
      [key]: value,
    });
  };

  const handleResetDefaults = () => {
    updateSetting("wslTimeouts", DEFAULT_WSL_TIMEOUTS);
  };

  return (
    <div className="space-y-8">
      {/* Timeout Section Header */}
      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <ClockIcon size="md" className="text-on-primary-container" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-on-surface">{t('timeouts.title')}</h2>
              <p className="text-sm text-on-surface-variant">{t('timeouts.description')}</p>
            </div>
          </div>

          {/* Info box */}
          <div className="mb-6 p-4 bg-surface-container/50 border border-outline-variant/50 rounded-lg">
            <p className="text-xs text-on-surface-variant">
              {t('timeouts.infoBox')}
            </p>
          </div>

          {/* Quick Operations */}
          <div className="mb-6 pb-6 border-b border-outline-variant/50">
            <h3 className="text-sm font-medium text-on-surface-variant mb-2">{t('timeouts.quick')}</h3>
            <SettingSelect
              label={t('timeouts.quickLabel')}
              description={t('timeouts.quickDesc')}
              value={settings.wslTimeouts.quickSecs}
              options={quickTimeoutOptions}
              onChange={(v) => handleTimeoutChange("quickSecs", v as number)}
            />
          </div>

          {/* Standard Operations */}
          <div className="mb-6 pb-6 border-b border-outline-variant/50">
            <h3 className="text-sm font-medium text-on-surface-variant mb-2">{t('timeouts.default')}</h3>
            <SettingSelect
              label={t('timeouts.defaultLabel')}
              description={t('timeouts.defaultDesc')}
              value={settings.wslTimeouts.defaultSecs}
              options={defaultTimeoutOptions}
              onChange={(v) => handleTimeoutChange("defaultSecs", v as number)}
            />
          </div>

          {/* Long Operations */}
          <div className="mb-6 pb-6 border-b border-outline-variant/50">
            <h3 className="text-sm font-medium text-on-surface-variant mb-2">{t('timeouts.long')}</h3>
            <SettingSelect
              label={t('timeouts.longLabel')}
              description={t('timeouts.longDesc')}
              value={settings.wslTimeouts.longSecs}
              options={longTimeoutOptions}
              onChange={(v) => handleTimeoutChange("longSecs", v as number)}
            />
          </div>

          {/* Shell Commands */}
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-on-surface-variant mb-2">{t('timeouts.customActions')}</h3>
            <SettingSelect
              label={t('timeouts.shell')}
              description={t('timeouts.shellDesc')}
              value={settings.wslTimeouts.shellSecs}
              options={shellTimeoutOptions}
              onChange={(v) => handleTimeoutChange("shellSecs", v as number)}
            />

            <SettingSelect
              label={t('timeouts.sudoShell')}
              description={t('timeouts.sudoShellDesc')}
              value={settings.wslTimeouts.sudoShellSecs}
              options={sudoTimeoutOptions}
              onChange={(v) => handleTimeoutChange("sudoShellSecs", v as number)}
            />
          </div>

          {/* Reset to Defaults */}
          <div className="mt-6 pt-6 border-t border-outline-variant/50 flex justify-end">
            <button
              onClick={handleResetDefaults}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {t('timeouts.resetDefaults')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
