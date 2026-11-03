/**
 * WSL Global Settings Component
 *
 * Settings that apply to the entire WSL2 installation.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { wslService } from "../../services/wslService";
import { useSettingsStore } from "../../store/settingsStore";
import type { WslConfig } from "../../types/settings";
import { DEFAULT_WSL_CONFIG } from "../../types/settings";
import { Toggle, SettingInput } from "./FormControls";
import { CPUIcon, SettingsIcon, NetworkIcon, DownloadIcon, ExternalLinkIcon, GpuIcon } from "../icons";
import { logger } from "../../utils/logger";

export function WslGlobalSettings() {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useState<WslConfig>(DEFAULT_WSL_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { settings, updateSetting } = useSettingsStore();

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await wslService.getWslConfig();
      setConfig(loaded);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('wslGlobal.loadError');
      logger.error("Failed to load WSL config:", "WslGlobalSettings", err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const updateConfig = <K extends keyof WslConfig>(key: K, value: WslConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
    setError(null); // Clear error when user makes changes
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await wslService.saveWslConfig(config);
      setHasChanges(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('wslGlobal.saveError');
      logger.error("Failed to save WSL config:", "WslGlobalSettings", err);
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const openWindowsWslSettings = async () => {
    try {
      await wslService.openWslSettings();
    } catch (error) {
      logger.error("Failed to open Windows WSL Settings:", "WslGlobalSettings", error);
    }
  };

  return (
    <div className="space-y-6" data-testid="wsl-global-settings">
      {/* Link to Windows WSL Settings app */}
      <div className="flex items-center justify-between p-4 bg-surface-container-low/50 border border-outline-variant rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
            <SettingsIcon className="text-on-primary-container" size="md" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-on-surface">{t('wslGlobal.windowsSettings')}</h3>
            <p className="text-xs text-on-surface-variant">{t('wslGlobal.windowsSettingsDesc')}</p>
          </div>
        </div>
        <button
          onClick={openWindowsWslSettings}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-surface bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg transition-colors"
        >
          <ExternalLinkIcon size="sm" />
          <span>{t('wslGlobal.open')}</span>
        </button>
      </div>

      <div className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-4">
        <p className="relative text-sm text-warning">
          {t('wslGlobal.restartNote')}
        </p>
      </div>

      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <CPUIcon className="text-on-primary-container" size="md" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-on-surface">{t('wslGlobal.resources')}</h3>
              <p className="text-sm text-on-surface-variant">{t('wslGlobal.resourcesDesc')}</p>
            </div>
          </div>
          <div className="space-y-1 divide-y divide-outline-variant/50">
            <SettingInput
              label={t('wslGlobal.memory')}
              description={t('wslGlobal.memoryDesc')}
              value={config.memory || ""}
              onChange={(v) => updateConfig("memory", v || undefined)}
              placeholder={t('wslGlobal.memoryPlaceholder')}
              testId="wsl-memory"
            />
            <SettingInput
              label={t('wslGlobal.processors')}
              description={t('wslGlobal.processorsDesc')}
              value={config.processors?.toString() || ""}
              onChange={(v) => {
                // Backend field is u32: negative/decimal input would fail the
                // whole save with an opaque serde error (GH #118). Use Number
                // (not parseInt) so "1.5" is rejected instead of truncated to 1.
                const n = Number(v);
                updateConfig(
                  "processors",
                  v && Number.isInteger(n) && n >= 1 && n <= 4294967295 ? n : undefined,
                );
              }}
              placeholder={t('wslGlobal.processorsPlaceholder')}
              type="number"
              min={1}
              step={1}
              testId="wsl-processors"
            />
            <SettingInput
              label={t('wslGlobal.swap')}
              description={t('wslGlobal.swapDesc')}
              value={config.swap || ""}
              onChange={(v) => updateConfig("swap", v || undefined)}
              placeholder={t('wslGlobal.swapPlaceholder')}
              testId="wsl-swap"
            />
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <SettingsIcon className="text-on-primary-container" size="md" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-on-surface">{t('wslGlobal.features')}</h3>
              <p className="text-sm text-on-surface-variant">{t('wslGlobal.featuresDesc')}</p>
            </div>
          </div>
          <div className="space-y-1 divide-y divide-outline-variant/50">
            <Toggle
              label={t('wslGlobal.guiApplications')}
              description={t('wslGlobal.guiApplicationsDesc')}
              checked={config.guiApplications ?? true}
              onChange={(v) => updateConfig("guiApplications", v)}
              testId="wsl-gui-apps"
            />
            <Toggle
              label={t('wslGlobal.localhostForwarding')}
              description={t('wslGlobal.localhostForwardingDesc')}
              checked={config.localhostForwarding ?? true}
              onChange={(v) => updateConfig("localhostForwarding", v)}
              testId="wsl-localhost-forwarding"
            />
            <Toggle
              label={t('wslGlobal.nestedVirtualization')}
              description={t('wslGlobal.nestedVirtualizationDesc')}
              checked={config.nestedVirtualization ?? false}
              onChange={(v) => updateConfig("nestedVirtualization", v)}
              testId="wsl-nested-virtualization"
            />
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <GpuIcon className="text-on-primary-container" size="md" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-on-surface">{t('wslGlobal.gpu')}</h3>
              <p className="text-sm text-on-surface-variant">{t('wslGlobal.gpuDesc')}</p>
            </div>
          </div>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {t('wslGlobal.gpuNote')}
          </p>
          <p className="mt-2 text-xs text-on-surface-variant">
            {t('wslGlobal.gpuGuiNote')}
          </p>
        </div>
      </section>

      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <NetworkIcon className="text-on-primary-container" size="md" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-on-surface">{t('wslGlobal.networking')}</h3>
              <p className="text-sm text-on-surface-variant">{t('wslGlobal.networkingDesc')}</p>
            </div>
          </div>
          <div className="space-y-1 divide-y divide-outline-variant/50">
            <div className="py-3">
              <label className="block text-sm font-medium text-on-surface mb-1">{t('wslGlobal.networkingMode')}</label>
              <p className="text-xs text-on-surface-variant mb-2">{t('wslGlobal.networkingModeDesc')}</p>
              <select
                value={config.networkingMode || "NAT"}
                onChange={(e) => updateConfig("networkingMode", e.target.value)}
                data-testid="wsl-networking-mode-select"
                className="w-full px-3 py-2 bg-surface-container-low/50 border border-outline-variant rounded-lg text-on-surface focus:border-tertiary"
              >
                <option value="NAT">{t('wslGlobal.natDefault')}</option>
                <option value="mirrored">{t('wslGlobal.mirrored')}</option>
                <option value="virtioproxy">{t('wslGlobal.virtioproxy')}</option>
                <option value="none">{t('wslGlobal.networkingModeNone')}</option>
                <option value="bridged">{t('wslGlobal.bridgedDeprecated')}</option>
              </select>
              {config.networkingMode === "bridged" && (
                <p className="text-xs text-warning mt-2" data-testid="wsl-networking-mode-bridged-warning">
                  {t('wslGlobal.bridgedDeprecatedWarning')}
                </p>
              )}
            </div>
            <Toggle
              label={t('wslGlobal.dnsTunneling')}
              description={t('wslGlobal.dnsTunnelingDesc')}
              checked={config.dnsTunneling ?? true}
              onChange={(v) => updateConfig("dnsTunneling", v)}
              testId="wsl-dns-tunneling"
            />
            <Toggle
              label={t('wslGlobal.firewall')}
              description={t('wslGlobal.firewallDesc')}
              checked={config.firewall ?? true}
              onChange={(v) => updateConfig("firewall", v)}
              testId="wsl-firewall"
            />
            <p className="pt-3 text-xs text-on-surface-variant italic">{t('wslGlobal.networkingRequiresWin11')}</p>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
              <DownloadIcon className="text-on-primary-container" size="md" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-on-surface">{t('wslGlobal.updates')}</h3>
              <p className="text-sm text-on-surface-variant">{t('wslGlobal.updatesDesc')}</p>
            </div>
          </div>
          <div className="space-y-1 divide-y divide-outline-variant/50">
            <Toggle
              label={t('wslGlobal.preReleaseUpdates')}
              description={t('wslGlobal.preReleaseUpdatesDesc')}
              checked={settings.usePreReleaseUpdates}
              onChange={(v) => updateSetting("usePreReleaseUpdates", v)}
              testId="wsl-prerelease-updates"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="p-4 bg-error-container border border-outline-variant rounded-xl" data-testid="wsl-config-error">
          <p className="text-sm text-error">
            <span className="font-medium">{t('wslGlobal.errorLabel')}</span> {error}
          </p>
        </div>
      )}

      {(hasChanges || error) && (
        <div className="sticky bottom-4 flex justify-end gap-3">
          {error && (
            <button
              onClick={() => setError(null)}
              className="px-4 py-3 bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-medium rounded-lg transition-colors"
            >
              {t('common:button.dismiss')}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            data-testid="wsl-save-button"
            className="px-6 py-3 bg-primary state-layer text-on-primary font-medium rounded-lg shadow-md3-1 transition-colors disabled:opacity-50"
          >
            {isSaving ? t('wslGlobal.saving') : error ? t('wslGlobal.retrySave') : t('wslGlobal.saveChanges')}
          </button>
        </div>
      )}
    </div>
  );
}





