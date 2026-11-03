/**
 * Distribution Sources Settings Component
 *
 * Allows users to configure LXC catalog settings and other distribution sources.
 */

import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import { Toggle } from "./FormControls";
import { DEFAULT_DISTRIBUTION_SOURCE_SETTINGS } from "../../types/lxcCatalog";
import { lxcCatalogService } from "../../services/lxcCatalogService";

// Cache duration options in hours
const CACHE_DURATION_OPTIONS = [
  { value: 1, label: "1 hour" },
  { value: 6, label: "6 hours" },
  { value: 12, label: "12 hours" },
  { value: 24, label: "24 hours" },
  { value: 48, label: "48 hours" },
  { value: 168, label: "1 week" },
];

export function DistributionSourcesSettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSetting } = useSettingsStore();
  const sources = settings.distributionSources;

  const handleSourceChange = <K extends keyof typeof sources>(
    key: K,
    value: (typeof sources)[K]
  ) => {
    updateSetting("distributionSources", {
      ...sources,
      [key]: value,
    });
  };

  const handleResetUrl = () => {
    handleSourceChange("lxcBaseUrl", DEFAULT_DISTRIBUTION_SOURCE_SETTINGS.lxcBaseUrl);
  };

  const handleClearCache = () => {
    lxcCatalogService.clearCache();
    // Show a brief confirmation by updating state (optional)
  };

  const handleResetDefaults = () => {
    updateSetting("distributionSources", DEFAULT_DISTRIBUTION_SOURCE_SETTINGS);
    lxcCatalogService.clearCache();
  };

  const cacheInfo = lxcCatalogService.getCacheInfo();

  return (
    <div className="space-y-8">
      {/* Distribution Sources Section Header */}
      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <svg className="w-5 h-5 text-on-primary-container" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-medium text-on-surface">{t('distributionSources.title')}</h2>
              <p className="text-sm text-on-surface-variant">{t('distributionSources.description')}</p>
            </div>
          </div>

          {/* Enable/Disable Toggle */}
          <div className="mb-6 pb-6 border-b border-outline-variant/50">
            <Toggle
              label={t('distributionSources.lxcEnabled')}
              description={t('distributionSources.lxcEnabledDesc')}
              checked={sources.lxcEnabled}
              onChange={(v) => handleSourceChange("lxcEnabled", v)}
            />
          </div>

          {/* LXC Settings */}
          <div className={`space-y-4 ${!sources.lxcEnabled ? "opacity-50 pointer-events-none" : ""}`}>
            {/* Base URL */}
            <div className="py-3">
              <label className="block text-sm font-medium text-on-surface mb-1">
                {t('distributionSources.lxcBaseUrl')}
              </label>
              <p className="text-xs text-on-surface-variant mb-2">
                {t('distributionSources.lxcBaseUrlDesc')}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sources.lxcBaseUrl}
                  onChange={(e) => handleSourceChange("lxcBaseUrl", e.target.value)}
                  disabled={!sources.lxcEnabled}
                  className="flex-1 px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface text-sm focus:border-tertiary disabled:opacity-50"
                />
                <button
                  onClick={handleResetUrl}
                  disabled={!sources.lxcEnabled || sources.lxcBaseUrl === DEFAULT_DISTRIBUTION_SOURCE_SETTINGS.lxcBaseUrl}
                  className="px-3 py-2 bg-surface-container border border-outline-variant rounded-lg text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {t('distributionSources.reset')}
                </button>
              </div>
            </div>

            {/* Cache Duration */}
            <div className="py-3">
              <label className="block text-sm font-medium text-on-surface mb-1">
                {t('distributionSources.cacheDuration')}
              </label>
              <p className="text-xs text-on-surface-variant mb-2">
                {t('distributionSources.cacheDurationDesc')}
              </p>
              <select
                value={sources.cacheDurationHours}
                onChange={(e) => handleSourceChange("cacheDurationHours", Number(e.target.value))}
                disabled={!sources.lxcEnabled}
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-tertiary disabled:opacity-50"
              >
                {CACHE_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Show Unstable Releases */}
            <div className="py-3">
              <Toggle
                label={t('distributionSources.showUnstable')}
                description={t('distributionSources.showUnstableDesc')}
                checked={sources.showUnstableReleases}
                onChange={(v) => handleSourceChange("showUnstableReleases", v)}
              />
            </div>
          </div>

          {/* Cache Status */}
          <div className="mt-6 pt-6 border-t border-outline-variant/50">
            <p className="text-xs text-on-surface-variant mb-3">{t('distributionSources.cacheStatus')}</p>
            <div className="p-3 bg-surface-container/50 rounded-md text-sm">
              {cacheInfo.lastUpdated ? (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">{t('distributionSources.lastUpdated')}</span>
                    <span className="text-on-surface font-mono">
                      {new Date(cacheInfo.lastUpdated).toLocaleDateString()}{" "}
                      {new Date(cacheInfo.lastUpdated).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">{t('distributionSources.expires')}</span>
                    <span className="text-on-surface font-mono">
                      {cacheInfo.expiresAt
                        ? new Date(cacheInfo.expiresAt) > new Date()
                          ? t('distributionSources.expiresIn', { hours: Math.round((new Date(cacheInfo.expiresAt).getTime() - Date.now()) / 3600000) })
                          : t('distributionSources.expired')
                        : t('distributionSources.na')}
                    </span>
                  </div>
                </div>
              ) : (
                <span className="text-on-surface-variant">{t('distributionSources.noCacheData')}</span>
              )}
            </div>
            <button
              onClick={handleClearCache}
              disabled={!cacheInfo.lastUpdated}
              className="mt-3 text-xs text-tertiary hover:text-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('distributionSources.clearCache')}
            </button>
          </div>

          {/* Reset to Defaults */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetDefaults}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {t('distributionSources.resetDefaults')}
            </button>
          </div>

          <p className="mt-4 text-xs text-on-surface-variant">
            {t('distributionSources.communityNotePrefix')}
            <a href="https://images.linuxcontainers.org" target="_blank" rel="noopener noreferrer" className="text-tertiary hover:underline">{t('distributionSources.communityNoteLinkText')}</a>
            {t('distributionSources.communityNoteSuffix')}
          </p>
        </div>
      </section>
    </div>
  );
}
