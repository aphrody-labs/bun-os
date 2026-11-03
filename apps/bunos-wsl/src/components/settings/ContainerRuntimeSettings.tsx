/**
 * Container Runtime Settings Component
 *
 * Allows users to configure which container runtime to use for pulling OCI images.
 */

import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import { DockerLogo } from "../icons/DistroLogos";
import type { ContainerRuntime } from "../../types/settings";

const RUNTIME_OPTION_KEYS = [
  { value: "builtin", labelKey: "containerRuntime.builtin", descKey: "containerRuntime.builtinDesc" },
  { value: "docker", labelKey: "containerRuntime.docker", descKey: "containerRuntime.dockerDesc" },
  { value: "podman", labelKey: "containerRuntime.podman", descKey: "containerRuntime.podmanDesc" },
  { value: "custom", labelKey: "containerRuntime.custom", descKey: "containerRuntime.customDesc" },
];

export function ContainerRuntimeSettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSetting } = useSettingsStore();

  const currentRuntime = settings.containerRuntime;
  const isCustom = typeof currentRuntime === "object" && "custom" in currentRuntime;
  const selectedValue = isCustom ? "custom" : currentRuntime;
  const customCommand = isCustom ? currentRuntime.custom : "";

  const handleRuntimeChange = (value: string) => {
    if (value === "custom") {
      updateSetting("containerRuntime", { custom: customCommand || "docker" });
    } else {
      updateSetting("containerRuntime", value as ContainerRuntime);
    }
  };

  const handleCustomCommandChange = (command: string) => {
    updateSetting("containerRuntime", { custom: command });
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center shadow-lg">
              <DockerLogo size={24} />
            </div>
            <div>
              <h2 className="text-lg font-medium text-on-surface">{t('containerRuntime.title')}</h2>
              <p className="text-sm text-on-surface-variant">{t('containerRuntime.description')}</p>
            </div>
          </div>

          {/* Info box */}
          <div className="mb-6 p-4 bg-surface-container/50 border border-outline-variant/50 rounded-lg">
            <p className="text-xs text-on-surface-variant">
              {t('containerRuntime.infoBox')}
            </p>
          </div>

          {/* Runtime Options */}
          <div className="space-y-3">
            {RUNTIME_OPTION_KEYS.map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                  selectedValue === option.value
                    ? "border-primary/50 bg-primary/10"
                    : "border-outline-variant bg-surface-container/30 hover:border-outline-variant"
                }`}
              >
                <input
                  type="radio"
                  name="containerRuntime"
                  value={option.value}
                  checked={selectedValue === option.value}
                  onChange={(e) => handleRuntimeChange(e.target.value)}
                  className="mt-1 accent-primary"
                />
                <div className="flex-1">
                  <div className="font-medium text-on-surface">{t(option.labelKey)}</div>
                  <div className="text-xs text-on-surface-variant mt-0.5">{t(option.descKey)}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Custom command input */}
          {selectedValue === "custom" && (
            <div className="mt-4 pl-7">
              <label className="block text-sm font-medium text-on-surface mb-1">
                {t('containerRuntime.customCommand')}
              </label>
              <p className="text-xs text-on-surface-variant mb-2">
                {t('containerRuntime.customCommandDesc')}
              </p>
              <input
                type="text"
                value={customCommand}
                onChange={(e) => handleCustomCommandChange(e.target.value)}
                placeholder={t('containerRuntime.customPlaceholder')}
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant/50 focus:outline-hidden focus:border-primary font-mono text-sm"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
