/**
 * WSL Per-Distribution Settings Component
 *
 * Settings that apply to individual WSL distributions (wsl.conf).
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { wslService } from "../../services/wslService";
import { useDistroStore } from "../../store/distroStore";
import { useNotificationStore } from "../../store/notificationStore";
import type { WslConf, GpuStatus, NvidiaContainerToolkitStatus } from "../../types/settings";
import { DEFAULT_WSL_CONF } from "../../types/settings";
import { Toggle, SettingInput } from "./FormControls";
import { FolderIcon, NetworkIcon, TerminalIcon, SparklesIcon, UserIcon, GpuIcon } from "../icons";
import { logger } from "../../utils/logger";

export function WslDistroSettings() {
  const { t } = useTranslation("settings");
  const { distributions, startDistro, actionInProgress } = useDistroStore();
  const [selectedDistro, setSelectedDistro] = useState<string>("");
  const [config, setConfig] = useState<WslConf>(DEFAULT_WSL_CONF);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [gpuChecking, setGpuChecking] = useState(false);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [toolkitStatus, setToolkitStatus] = useState<NvidiaContainerToolkitStatus | null>(null);
  const [toolkitChecking, setToolkitChecking] = useState(false);
  const [toolkitError, setToolkitError] = useState<string | null>(null);
  const selectionGeneration = useRef(0);
  const selectedDistroInfo = distributions.find(d => d.name === selectedDistro);
  const canStartSelectedDistro = selectedDistroInfo?.state === "Stopped"
    || selectedDistroInfo?.state === "Unknown";

  useEffect(() => {
    if (distributions.length > 0 && !selectedDistro) {
      setSelectedDistro(distributions[0].name);
    }
  }, [distributions, selectedDistro]);

  useEffect(() => {
    selectionGeneration.current += 1;
    setGpuChecking(false);
    setToolkitChecking(false);
    setIsLoading(false);
    setIsSaving(false);
    if (selectedDistro) {
      setGpuStatus(null);
      setGpuError(null);
      setToolkitStatus(null);
      setToolkitError(null);

      if (selectedDistroInfo?.state === "Running") {
        loadConfig(selectedDistro);
      } else {
        setConfig(DEFAULT_WSL_CONF);
        setHasChanges(false);
        setError(null);
      }
    }
    return () => { selectionGeneration.current += 1; };
  }, [selectedDistro, selectedDistroInfo?.state]);

  const checkGpuStatus = async () => {
    if (!selectedDistro) return;
    const generation = selectionGeneration.current;
    setGpuChecking(true);
    setGpuError(null);
    try {
      const distro = distributions.find(d => d.name === selectedDistro);
      const status = await wslService.getDistroGpuStatus(selectedDistro, distro?.id);
      if (generation !== selectionGeneration.current) return;
      setGpuStatus(status);
      setGpuError(null);
      // Auto-check toolkit status when NVIDIA is available
      if (status.nvidiaAvailable) {
        checkToolkitStatus(distro?.id);
      }
    } catch (err) {
      if (generation !== selectionGeneration.current) return;
      const message = err instanceof Error ? err.message : t('wslDistro.gpuCheckError');
      logger.error("Failed to check GPU status:", "WslDistroSettings", err);
      setGpuError(message);
      setGpuStatus(null);
    } finally {
      if (generation === selectionGeneration.current) setGpuChecking(false);
    }
  };

  const checkToolkitStatus = async (id?: string) => {
    if (!selectedDistro) return;
    const generation = selectionGeneration.current;
    setToolkitChecking(true);
    setToolkitError(null);
    try {
      const status = await wslService.checkNvidiaContainerToolkit(selectedDistro, id);
      if (generation !== selectionGeneration.current) return;
      setToolkitStatus(status);
    } catch (err) {
      if (generation !== selectionGeneration.current) return;
      const message = err instanceof Error ? err.message : t('wslDistro.toolkitCheckError');
      logger.error("Failed to check toolkit status:", "WslDistroSettings", err);
      setToolkitError(message);
    } finally {
      if (generation === selectionGeneration.current) setToolkitChecking(false);
    }
  };

  const loadConfig = async (distroName: string) => {
    const generation = selectionGeneration.current;
    setIsLoading(true);
    setHasChanges(false);
    setError(null);
    try {
      // Find the distribution to get its id for more reliable identification
      const distro = distributions.find(d => d.name === distroName);
      const loaded = await wslService.getWslConf(distroName, distro?.id);
      if (generation !== selectionGeneration.current) return;
      setConfig(loaded);
    } catch (err) {
      if (generation !== selectionGeneration.current) return;
      const message = err instanceof Error ? err.message : t('wslDistro.loadError');
      logger.error("Failed to load wsl.conf:", "WslDistroSettings", err);
      setError(message);
      setConfig(DEFAULT_WSL_CONF);
    } finally {
      if (generation === selectionGeneration.current) setIsLoading(false);
    }
  };

  const updateConfig = <K extends keyof WslConf>(key: K, value: WslConf[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
    setError(null); // Clear error when user makes changes
  };

  const handleSave = async () => {
    if (!selectedDistro) return;
    const distroName = selectedDistro;
    const generation = selectionGeneration.current;
    setIsSaving(true);
    setError(null);
    try {
      await wslService.saveWslConf(distroName, config);
      if (generation !== selectionGeneration.current) return;
      setHasChanges(false);
    } catch (err) {
      const message = typeof err === "string" ? err : err instanceof Error ? err.message : t('wslDistro.saveError');
      logger.error("Failed to save wsl.conf:", "WslDistroSettings", err);
      if (generation !== selectionGeneration.current) {
        // The backend write still completes after navigation. Report its failure
        // globally without changing another distribution's form (or an unmounted one).
        useNotificationStore.getState().addNotification({
          type: "error",
          title: `${distroName}: ${t('wslDistro.saveError')}`,
          message,
          autoDismiss: 0,
        });
      } else {
        setError(message);
      }
    } finally {
      if (generation === selectionGeneration.current) setIsSaving(false);
    }
  };

  const handleStartAndLoad = async () => {
    if (!selectedDistroInfo || !canStartSelectedDistro) return;
    await startDistro(selectedDistroInfo.name, selectedDistroInfo.id);
  };

  if (distributions.length === 0) {
    return (
      <div className="text-center py-12 text-on-surface-variant">
        <p>{t('wslDistro.noDistros')}</p>
        <p className="text-sm">{t('wslDistro.noDistrosHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="wsl-distro-settings">
      <div className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-4">
        <div className="relative text-sm text-warning space-y-1">
          <p>
            {t('wslDistro.noteWslConf')}
          </p>
          <p>
            {t('wslDistro.noteRestart')}
          </p>
        </div>
      </div>

      {/* Distribution selector */}
      <div className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-4">
        <div className="relative">
          <label className="block text-sm font-medium text-on-surface mb-2">{t('wslDistro.selectDistro')}</label>
          <select
            value={selectedDistro}
            onChange={(e) => setSelectedDistro(e.target.value)}
            data-testid="distro-settings-selector"
            className="w-full px-3 py-2 bg-surface-container-low/50 border border-outline-variant rounded-lg text-on-surface focus:border-primary"
          >
            {distributions.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} {d.isDefault ? t('wslDistro.defaultIndicator') : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedDistroInfo ? null : selectedDistroInfo.state !== "Running" ? (
        <div className="p-6 bg-surface-container-low/50 border border-outline-variant rounded-xl text-center">
          <p className="text-sm text-on-surface-variant mb-4">
            {t('wslDistro.requiresRunning')}
          </p>
          <button
            onClick={handleStartAndLoad}
            disabled={!canStartSelectedDistro || actionInProgress !== null}
            data-testid="distro-start-and-load-button"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary state-layer rounded-lg transition-opacity disabled:opacity-50"
          >
            {actionInProgress === `Starting ${selectedDistroInfo.name}...`
              ? t('wslDistro.starting')
              : t('wslDistro.startAndLoad')}
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                  <FolderIcon className="text-on-primary-container" size="md" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-on-surface">{t('wslDistro.automount')}</h3>
                  <p className="text-sm text-on-surface-variant">{t('wslDistro.automountDesc')}</p>
                </div>
              </div>
              <div className="space-y-1 divide-y divide-outline-variant/50">
                <Toggle
                  label={t('wslDistro.automountEnabled')}
                  description={t('wslDistro.automountEnabledDesc')}
                  checked={config.automountEnabled ?? true}
                  onChange={(v) => updateConfig("automountEnabled", v)}
                  testId="distro-automount-enabled"
                />
                <Toggle
                  label={t('wslDistro.automountFstab')}
                  description={t('wslDistro.automountFstabDesc')}
                  checked={config.automountMountFsTab ?? true}
                  onChange={(v) => updateConfig("automountMountFsTab", v)}
                  testId="distro-mount-fstab"
                />
                <SettingInput
                  label={t('wslDistro.automountRoot')}
                  description={t('wslDistro.automountRootDesc')}
                  value={config.automountRoot || ""}
                  onChange={(v) => updateConfig("automountRoot", v || undefined)}
                  placeholder="/mnt/"
                  testId="distro-mount-root"
                />
                <SettingInput
                  label={t('wslDistro.automountOptions')}
                  description={t('wslDistro.automountOptionsDesc')}
                  value={config.automountOptions || ""}
                  onChange={(v) => updateConfig("automountOptions", v || undefined)}
                  placeholder="metadata,uid=1000,gid=1000"
                  testId="distro-mount-options"
                />
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                  <NetworkIcon className="text-on-primary-container" size="md" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-on-surface">{t('wslDistro.network')}</h3>
                  <p className="text-sm text-on-surface-variant">{t('wslDistro.networkDesc')}</p>
                </div>
              </div>
              <div className="space-y-1 divide-y divide-outline-variant/50">
                <Toggle
                  label={t('wslDistro.generateHosts')}
                  description={t('wslDistro.generateHostsDesc')}
                  checked={config.networkGenerateHosts ?? true}
                  onChange={(v) => updateConfig("networkGenerateHosts", v)}
                  testId="distro-generate-hosts"
                />
                <Toggle
                  label={t('wslDistro.generateResolvConf')}
                  description={t('wslDistro.generateResolvConfDesc')}
                  checked={config.networkGenerateResolvConf ?? true}
                  onChange={(v) => updateConfig("networkGenerateResolvConf", v)}
                  testId="distro-generate-resolv"
                />
                <SettingInput
                  label={t('wslDistro.hostname')}
                  description={t('wslDistro.hostnameDesc')}
                  value={config.networkHostname || ""}
                  onChange={(v) => updateConfig("networkHostname", v || undefined)}
                  placeholder={t('wslDistro.hostnamePlaceholder')}
                  testId="distro-hostname"
                />
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                  <TerminalIcon className="text-on-primary-container" size="md" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-on-surface">{t('wslDistro.interop')}</h3>
                  <p className="text-sm text-on-surface-variant">{t('wslDistro.interopDesc')}</p>
                </div>
              </div>
              <div className="space-y-1 divide-y divide-outline-variant/50">
                <Toggle
                  label={t('wslDistro.interopEnabled')}
                  description={t('wslDistro.interopEnabledDesc')}
                  checked={config.interopEnabled ?? true}
                  onChange={(v) => updateConfig("interopEnabled", v)}
                  testId="distro-interop-enabled"
                />
                <Toggle
                  label={t('wslDistro.appendWindowsPath')}
                  description={t('wslDistro.appendWindowsPathDesc')}
                  checked={config.interopAppendWindowsPath ?? true}
                  onChange={(v) => updateConfig("interopAppendWindowsPath", v)}
                  testId="distro-append-path"
                />
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                  <SparklesIcon className="text-on-primary-container" size="md" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-on-surface">{t('wslDistro.boot')}</h3>
                  <p className="text-sm text-on-surface-variant">{t('wslDistro.bootDesc')}</p>
                </div>
              </div>
              <div className="space-y-1 divide-y divide-outline-variant/50">
                <Toggle
                  label={t('wslDistro.systemd')}
                  description={t('wslDistro.systemdDesc')}
                  checked={config.bootSystemd ?? true}
                  onChange={(v) => updateConfig("bootSystemd", v)}
                  testId="distro-systemd"
                />
                <SettingInput
                  label={t('wslDistro.bootCommand')}
                  description={t('wslDistro.bootCommandDesc')}
                  value={config.bootCommand || ""}
                  onChange={(v) => updateConfig("bootCommand", v || undefined)}
                  placeholder={t('wslDistro.bootCommandPlaceholder')}
                  testId="distro-boot-command"
                />
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                  <UserIcon className="text-on-primary-container" size="md" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-on-surface">{t('wslDistro.user')}</h3>
                  <p className="text-sm text-on-surface-variant">{t('wslDistro.userDesc')}</p>
                </div>
              </div>
              <div className="space-y-1">
                <SettingInput
                  label={t('wslDistro.defaultUser')}
                  description={t('wslDistro.defaultUserDesc')}
                  value={config.userDefault || ""}
                  onChange={(v) => updateConfig("userDefault", v || undefined)}
                  placeholder={t('wslDistro.defaultUserPlaceholder')}
                  testId="distro-default-user"
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
                  <h3 className="text-lg font-medium text-on-surface">{t('wslDistro.gpu')}</h3>
                  <p className="text-sm text-on-surface-variant">{t('wslDistro.gpuDesc')}</p>
                </div>
              </div>

              {gpuStatus ? (
                <div className="space-y-3" data-testid="distro-gpu-status">
                  <div className="flex items-center justify-between py-2 border-b border-outline-variant/50">
                    <span className="text-sm text-on-surface">{t('wslDistro.gpuDirectX')}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${gpuStatus.directxAvailable ? 'bg-success-container text-success' : 'bg-surface-container text-on-surface-variant'}`}>
                      {gpuStatus.directxAvailable ? t('wslDistro.gpuAvailableLabel') : t('wslDistro.gpuNotAvailableLabel')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-outline-variant/50">
                    <span className="text-sm text-on-surface">{t('wslDistro.gpuNvidia')}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${gpuStatus.nvidiaAvailable ? 'bg-success-container text-success' : 'bg-surface-container text-on-surface-variant'}`}>
                      {gpuStatus.nvidiaAvailable ? t('wslDistro.gpuAvailableLabel') : t('wslDistro.gpuNotAvailableLabel')}
                    </span>
                  </div>

                  {/* Container Toolkit section — only shown when NVIDIA is available */}
                  {gpuStatus.nvidiaAvailable && (
                    <div className="space-y-3 pt-1">
                      {toolkitChecking ? (
                        <p className="text-xs text-on-surface-variant">{t('wslDistro.toolkitChecking')}</p>
                      ) : toolkitStatus ? (
                        <>
                          <div className="flex items-center justify-between py-2 border-b border-outline-variant/50">
                            <span className="text-sm text-on-surface">{t('wslDistro.toolkitInstalled')}</span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${toolkitStatus.toolkitInstalled ? 'bg-success-container text-success' : 'bg-warning-container text-warning'}`}>
                              {toolkitStatus.toolkitInstalled ? t('wslDistro.gpuAvailableLabel') : t('wslDistro.gpuNotAvailableLabel')}
                            </span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-sm text-on-surface">{t('wslDistro.cdiSpecs')}</span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${toolkitStatus.cdiSpecsExist ? 'bg-success-container text-success' : 'bg-warning-container text-warning'}`}>
                              {toolkitStatus.cdiSpecsExist
                                ? (toolkitStatus.cdiDevices.length > 0 ? `${t('wslDistro.gpuAvailableLabel')} (${toolkitStatus.cdiDevices.length})` : t('wslDistro.gpuAvailableLabel'))
                                : t('wslDistro.gpuNotAvailableLabel')}
                            </span>
                          </div>

                          {(!toolkitStatus.toolkitInstalled || !toolkitStatus.cdiSpecsExist) && (
                            <button
                              onClick={() => openUrl("https://github.com/aphrody-labs/bun-os/blob/main/docs/TROUBLESHOOTING.md#gpu-containers")}
                              className="text-xs text-primary hover:text-primary transition-colors"
                            >
                              {t('wslDistro.toolkitTroubleshootingLink')}
                            </button>
                          )}
                        </>
                      ) : toolkitError ? (
                        <p className="text-xs text-warning">{toolkitError}</p>
                      ) : null}
                    </div>
                  )}

                  <button
                    onClick={checkGpuStatus}
                    disabled={gpuChecking}
                    className="mt-2 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    {t('wslDistro.gpuRecheck')}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {gpuError && (
                    <p className="text-sm text-warning">{gpuError}</p>
                  )}
                  <p className="text-xs text-on-surface-variant">{t('wslDistro.gpuNote')}</p>
                  <button
                    onClick={checkGpuStatus}
                    disabled={gpuChecking}
                    data-testid="distro-gpu-check-btn"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-surface bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg transition-colors disabled:opacity-50"
                  >
                    {gpuChecking ? t('wslDistro.gpuChecking') : t('wslDistro.gpuCheck')}
                  </button>
                </div>
              )}
            </div>
          </section>

          {error && (
            <div className="p-4 bg-error-container border border-outline-variant rounded-xl" data-testid="distro-config-error">
              <p className="text-sm text-error">
                <span className="font-medium">{t('wslDistro.errorLabel')}</span> {error}
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
                data-testid="distro-save-button"
                className="px-6 py-3 bg-primary state-layer text-on-primary font-medium rounded-lg shadow-md3-1 transition-colors disabled:opacity-50"
              >
                {isSaving ? t('wslDistro.saving') : error ? t('wslDistro.retrySave') : t('wslDistro.saveChanges')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}





