/**
 * Settings Page Component
 *
 * Main settings page with collapsible sidebar navigation.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "../store/settingsStore";
import { wslService, type WslVersionInfo } from "../services/wslService";
import { CustomActionsSettings } from "./CustomActionsSettings";
import { DistroSourcesSettings } from "./DistroSourcesSettings";
import { AppMark } from "./AppMark";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  TerminalIcon,
  ExternalLinkIcon,
  SettingsIcon,
  PaletteIcon,
  ServerIcon,
  FolderIcon,
  SparklesIcon,
  GridIcon,
  DownloadIcon,
  InfoIcon,
  RefreshIcon,
  ClockIcon,
  WindowIcon,
  ShieldIcon,
} from "./icons";
import {
  SettingSection,
  WslGlobalSettings,
  WslDistroSettings,
  ThemeSettings,
  PollingSettings,
  TimeoutSettings,
  ExecutablePathsSettings,
  DistributionSourcesSettings,
  WslDistroSourcesSettings,
  ContainerRuntimeSettings,
  PrivacySettings,
  LanguageSettings,
  IDE_PRESETS,
  TERMINAL_PRESETS,
  SETTINGS_TABS,
  getTerminalPresetsWithStatus,
} from "./settings";
import type { SettingsTab, SettingsIconName, PresetOption } from "./settings";

interface SettingsPageProps {
  onBack: () => void;
}

// Map icon names to components
const ICON_MAP: Record<SettingsIconName, React.FC<{ size?: "sm" | "md" | "lg"; className?: string }>> = {
  settings: SettingsIcon,
  palette: PaletteIcon,
  refresh: RefreshIcon,
  clock: ClockIcon,
  terminal: TerminalIcon,
  server: ServerIcon,
  folder: FolderIcon,
  sparkles: SparklesIcon,
  grid: GridIcon,
  download: DownloadIcon,
  shield: ShieldIcon,
  info: InfoIcon,
};

const SETTINGS_TAB_STORAGE_KEY = "wslui-settings-active-tab";

/** Map tab IDs with hyphens to camelCase translation keys */
function tabTranslationKey(tabId: string): string {
  switch (tabId) {
    case "wsl-global": return "wslGlobal";
    case "wsl-distro": return "wslDistro";
    default: return tabId;
  }
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const { t } = useTranslation("settings");
  const { settings, loadSettings, updateSetting, saveSettings, isLoading } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    // Restore saved tab from localStorage
    const saved = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (saved && SETTINGS_TABS.some(tab => tab.id === saved)) {
      return saved as SettingsTab;
    }
    return "app";
  });
  const [wslVersion, setWslVersion] = useState<WslVersionInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [terminalPresets, setTerminalPresets] = useState<PresetOption[]>(TERMINAL_PRESETS);

  // Persist active tab to localStorage
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Fetch installed terminals on component mount
  useEffect(() => {
    wslService.getInstalledTerminals()
      .then((terminals) => {
        setTerminalPresets(getTerminalPresetsWithStatus(terminals));
      })
      .catch(() => {
        // Keep default presets if detection fails
      });
  }, []);

  // Fetch WSL version and app version when About tab is active
  useEffect(() => {
    if (activeTab === "about") {
      wslService.getWslVersion().then(setWslVersion).catch(() => {});
      getVersion().then(setAppVersion).catch(() => {});
    }
  }, [activeTab]);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div
        className={`flex flex-col border-r border-outline-variant bg-surface-container-low/50 transition-all duration-200 ${
          sidebarExpanded ? "w-56" : "w-16"
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-outline-variant">
          <button
            onClick={onBack}
            data-testid="back-button"
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
            title={t('common:button.back')}
          >
            <ChevronLeftIcon size="md" />
          </button>
          {sidebarExpanded && (
            <h1 className="text-lg font-semibold text-on-surface">{t('title')}</h1>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {SETTINGS_TABS.map((tab) => {
            const IconComponent = ICON_MAP[tab.icon];
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                data-testid={`settings-tab-${tab.id}`}
                title={!sidebarExpanded ? t(`tabs.${tabTranslationKey(tab.id)}`) : undefined}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary border-r-2 border-primary"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
                } ${sidebarExpanded ? "" : "justify-center"}`}
              >
                <IconComponent
                  size="md"
                  className={isActive ? "text-primary" : "text-on-surface-variant"}
                />
                {sidebarExpanded && (
                  <span className="font-medium">{t(`tabs.${tabTranslationKey(tab.id)}`)}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Collapse Toggle */}
        <div className="border-t border-outline-variant p-2">
          <button
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
            title={sidebarExpanded ? t('sidebarCollapse') : t('sidebarExpand')}
          >
            {sidebarExpanded ? (
              <>
                <ChevronLeftIcon size="sm" />
                <span className="text-xs">{t('collapse')}</span>
              </>
            ) : (
              <ChevronRightIcon size="sm" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          <div className="max-w-2xl mx-auto">
            {activeTab === "app" && (
              <div className="space-y-8">
                <SettingSection
                  title={t('ide.title')}
                  description={t('ide.description')}
                  icon={<CodeIcon size="md" />}
                  presets={IDE_PRESETS}
                  currentValue={settings.ideCommand}
                  onValueChange={(value) => updateSetting("ideCommand", value)}
                  savedCustomValue={settings.savedCustomIdeCommand}
                  onCustomValueSave={(value) => saveSettings({
                    ...settings,
                    ideCommand: value,
                    savedCustomIdeCommand: value,
                  })}
                  customPlaceholder={t('ide.placeholder')}
                  customHelpText={
                    <div className="space-y-2">
                      <p><strong>{t('ide.note')}</strong></p>
                      <div>
                        <strong>{t('ide.placeholders')}</strong>
                        <ul className="list-disc list-inside ml-2 mt-1">
                          <li><code className="text-primary">$WSL_PATH</code> — {t('ide.wslPathDesc')}</li>
                          <li><code className="text-primary">$DISTRO_NAME</code> — {t('ide.distroNameDesc')}</li>
                        </ul>
                      </div>
                      <div>
                        <strong>{t('ide.example')}</strong>
                        <code className="block mt-1 p-2 bg-surface-container rounded text-on-surface-variant break-all">
                          "C:\Program Files\JetBrains\IntelliJ IDEA\bin\idea64.exe" $WSL_PATH\$DISTRO_NAME\home
                        </code>
                      </div>
                    </div>
                  }
                  isLoading={isLoading}
                  testId="ide-setting"
                />

                <SettingSection
                  title={t('terminal.title')}
                  description={t('terminal.description')}
                  icon={<TerminalIcon size="md" />}
                  presets={terminalPresets}
                  currentValue={settings.terminalCommand}
                  onValueChange={(value) => updateSetting("terminalCommand", value)}
                  savedCustomValue={settings.savedCustomTerminalCommand}
                  onCustomValueSave={(value) => saveSettings({
                    ...settings,
                    terminalCommand: value,
                    savedCustomTerminalCommand: value,
                  })}
                  customPlaceholder={t('terminal.placeholder')}
                  customHelpText={
                    <div className="space-y-2">
                      <p><strong>{t('terminal.note')}</strong></p>
                      <div>
                        <strong>{t('terminal.placeholders')}</strong>
                        <ul className="list-disc list-inside ml-2 mt-1">
                          <li><code className="text-primary">$WSL</code> — {t('terminal.wslDesc')}</li>
                          <li><code className="text-primary">$DISTRO_ARGS</code> — {t('terminal.distroArgsDesc')}</li>
                        </ul>
                      </div>
                      <div>
                        <strong>{t('terminal.examples')}</strong>
                        <ul className="list-disc list-inside ml-2 mt-1">
                          <li>{t('terminal.exampleAlacrittyLabel')}: <code className="text-on-surface-variant">{t('terminal.exampleAlacrittyCmd')}</code></li>
                          <li>{t('terminal.exampleKittyLabel')}: <code className="text-on-surface-variant">{t('terminal.exampleKittyCmd')}</code></li>
                          <li>{t('terminal.exampleWeztermLabel')}: <code className="text-on-surface-variant">{t('terminal.exampleWeztermCmd')}</code></li>
                        </ul>
                      </div>
                    </div>
                  }
                  isLoading={isLoading}
                  testId="terminal-setting"
                />

                {/* Window Behavior Section */}
                <div className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                        <WindowIcon size="md" className="text-on-primary-container" />
                      </div>
                      <div>
                        <h2 className="text-lg font-medium text-on-surface">{t('window.title')}</h2>
                        <p className="text-sm text-on-surface-variant">{t('window.description')}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center gap-3 p-4 bg-surface-container/50 rounded-lg border border-outline-variant/50 cursor-pointer hover:bg-surface-container/70 transition-colors">
                        <input
                          type="radio"
                          name="closeAction"
                          value="ask"
                          checked={settings.closeAction === "ask"}
                          onChange={() => updateSetting("closeAction", "ask")}
                          className="w-4 h-4 text-secondary bg-surface-container-high border-outline focus:ring-secondary"
                        />
                        <div>
                          <p className="text-sm font-medium text-on-surface">{t('window.ask')}</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">
                            {t('window.askDesc')}
                          </p>
                        </div>
                      </label>

                      <label className="flex items-center gap-3 p-4 bg-surface-container/50 rounded-lg border border-outline-variant/50 cursor-pointer hover:bg-surface-container/70 transition-colors">
                        <input
                          type="radio"
                          name="closeAction"
                          value="minimize"
                          checked={settings.closeAction === "minimize"}
                          onChange={() => updateSetting("closeAction", "minimize")}
                          className="w-4 h-4 text-secondary bg-surface-container-high border-outline focus:ring-secondary"
                        />
                        <div>
                          <p className="text-sm font-medium text-on-surface">{t('window.minimize')}</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">
                            {t('window.minimizeDesc')}
                          </p>
                        </div>
                      </label>

                      <label className="flex items-center gap-3 p-4 bg-surface-container/50 rounded-lg border border-outline-variant/50 cursor-pointer hover:bg-surface-container/70 transition-colors">
                        <input
                          type="radio"
                          name="closeAction"
                          value="quit"
                          checked={settings.closeAction === "quit"}
                          onChange={() => updateSetting("closeAction", "quit")}
                          className="w-4 h-4 text-secondary bg-surface-container-high border-outline focus:ring-secondary"
                        />
                        <div>
                          <p className="text-sm font-medium text-on-surface">{t('window.quit')}</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">
                            {t('window.quitDesc')}
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Language Settings */}
                <LanguageSettings />

                {/* Debug Logging Section */}
                <div className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                        <InfoIcon size="md" className="text-on-primary-container" />
                      </div>
                      <div>
                        <h2 className="text-lg font-medium text-on-surface">{t('troubleshooting.title')}</h2>
                        <p className="text-sm text-on-surface-variant">{t('troubleshooting.description')}</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-surface-container/50 rounded-lg border border-outline-variant/50">
                        <div>
                          <p className="text-sm font-medium text-on-surface">{t('troubleshooting.debugLogging')}</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">
                            {t('troubleshooting.debugLoggingDesc')}
                          </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settings.debugLogging}
                            onChange={(e) => {
                              updateSetting("debugLogging", e.target.checked);
                              // Also update runtime log level immediately
                              wslService.setDebugLogging(e.target.checked);
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-surface-container-high peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-secondary rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-outline-variant after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface-container-lowest after:border-outline-variant after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                        </label>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={async () => {
                            const logPath = await wslService.getLogPath();
                            wslService.openFolder(logPath);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-on-surface-variant bg-surface-container/50 hover:bg-surface-container-high/50 border border-outline-variant rounded-lg transition-colors"
                        >
                          <FolderIcon size="sm" />
                          <span>{t('troubleshooting.openLogFolder')}</span>
                        </button>
                        <a
                          href="https://github.com/aphrody-labs/bun-os/tree/os/docs/wsl"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-on-surface-variant bg-surface-container/50 hover:bg-surface-container-high/50 border border-outline-variant rounded-lg transition-colors"
                        >
                          <ExternalLinkIcon size="sm" />
                          <span>{t('troubleshooting.troubleshootingGuide')}</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "appearance" && <ThemeSettings />}

            {activeTab === "polling" && <PollingSettings />}

            {activeTab === "timeouts" && <TimeoutSettings />}

            {activeTab === "executables" && <ExecutablePathsSettings />}

            {activeTab === "wsl-global" && <WslGlobalSettings />}

            {activeTab === "wsl-distro" && <WslDistroSettings />}

            {activeTab === "actions" && <CustomActionsSettings />}

            {activeTab === "distros" && <DistroSourcesSettings />}

            {activeTab === "sources" && (
              <div className="space-y-6">
                <WslDistroSourcesSettings />
                <ContainerRuntimeSettings />
                <DistributionSourcesSettings />
              </div>
            )}

            {activeTab === "privacy" && <PrivacySettings />}

            {activeTab === "about" && (
              <div className="space-y-6">
                {/* App Hero */}
                <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-8">
                  <div className="relative flex items-center gap-5">
                    <AppMark size={64} className="flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-semibold text-on-surface">
                          Bun OS <span className="font-bold text-primary">WSL</span>
                        </h2>
                        {appVersion && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-secondary-container text-on-secondary-container rounded-full border border-outline-variant">
                            v{appVersion}
                          </span>
                        )}
                      </div>
                      <p className="text-on-surface-variant mt-1">{t('about.description')}</p>
                      <p className="text-outline text-sm mt-1">{t('about.builtWith')}</p>
                    </div>
                  </div>
                  <div className="relative mt-6 pt-4 border-t border-outline-variant/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <a
                        href="https://github.com/aphrody-labs/bun-os/tree/os/docs/wsl"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container/50 hover:bg-surface-container-high/50 border border-outline-variant rounded-lg transition-colors"
                      >
                        <ExternalLinkIcon size="sm" />
                        <span>{t('about.website')}</span>
                      </a>
                      <a
                        href="https://github.com/aphrody-labs/bun-os"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container/50 hover:bg-surface-container-high/50 border border-outline-variant rounded-lg transition-colors"
                      >
                        <ExternalLinkIcon size="sm" />
                        <span>{t('about.github')}</span>
                      </a>
                    </div>
                    <a
                      href="http://www.octasoft.co.uk"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors"
                    >
                      <span className="text-on-surface-variant text-sm">{t('about.developedBy')}</span>
                      <img
                        src="/octasoft-logo.png"
                        alt="Aphrody Labs"
                        className="h-6 w-6 rounded"
                      />
                      <span className="font-medium text-sm">Aphrody Labs</span>
                    </a>
                  </div>
                </section>

                {/* License Info */}
                <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                        <InfoIcon size="md" className="text-on-primary-container" />
                      </div>
                      <div>
                        <h2 className="text-lg font-medium text-on-surface">{t('about.license.title')}</h2>
                        <p className="text-sm text-on-surface-variant">{t('about.license.type')}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-surface-container-low/30 rounded-lg p-4 border border-outline-variant/50">
                        <p className="text-sm text-on-surface-variant">
                          {t('about.license.freeText')}
                        </p>
                        <p className="text-xs text-on-surface-variant mt-2">
                          {t('about.license.conversion')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <a
                          href="https://github.com/aphrody-labs/bun-os/blob/main/LICENSE"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-success hover:text-success bg-success-container hover:bg-success-container border border-outline-variant rounded-lg transition-colors"
                        >
                          <ExternalLinkIcon size="sm" />
                          <span>{t('about.license.view')}</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </section>

                {/* WSL Version Info */}
                <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                        <TerminalIcon size="md" className="text-on-primary-container" />
                      </div>
                      <div>
                        <h2 className="text-lg font-medium text-on-surface">{t('about.wslInfo.title')}</h2>
                        <p className="text-sm text-on-surface-variant">{t('about.wslInfo.description')}</p>
                      </div>
                    </div>
                    {wslVersion ? (
                      <div className="text-sm space-y-2">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 bg-surface-container-low/30 rounded-lg p-4 border border-outline-variant/50">
                          <span className="text-on-surface-variant">{t('about.wslInfo.wslVersion')}</span>
                          <span className="text-secondary font-mono">{wslVersion.wslVersion}</span>
                          <span className="text-on-surface-variant">{t('about.wslInfo.kernelVersion')}</span>
                          <span className="text-on-surface font-mono">{wslVersion.kernelVersion}</span>
                          <span className="text-on-surface-variant">{t('about.wslInfo.wslgVersion')}</span>
                          <span className="text-on-surface font-mono">{wslVersion.wslgVersion}</span>
                          <span className="text-on-surface-variant">{t('about.wslInfo.msrdcVersion')}</span>
                          <span className="text-on-surface font-mono">{wslVersion.msrdcVersion}</span>
                          <span className="text-on-surface-variant">{t('about.wslInfo.direct3dVersion')}</span>
                          <span className="text-on-surface-variant font-mono text-xs">{wslVersion.direct3dVersion}</span>
                          <span className="text-on-surface-variant">{t('about.wslInfo.dxcoreVersion')}</span>
                          <span className="text-on-surface-variant font-mono text-xs">{wslVersion.dxcoreVersion}</span>
                          <span className="text-on-surface-variant">{t('about.wslInfo.windowsVersion')}</span>
                          <span className="text-on-surface font-mono">{wslVersion.windowsVersion}</span>
                        </div>
                        <div className="pt-3 mt-1">
                          <a
                            href="https://github.com/microsoft/WSL"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-secondary bg-secondary-container hover:bg-secondary-container border border-outline-variant rounded-lg transition-colors"
                          >
                            <ExternalLinkIcon size="sm" />
                            <span>{t('about.wslInfo.wslGithub')}</span>
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-on-surface-variant p-4">
                        <div className="w-4 h-4 border-2 border-secondary border-t-secondary rounded-full animate-spin" />
                        <span>{t('about.wslInfo.loading')}</span>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
