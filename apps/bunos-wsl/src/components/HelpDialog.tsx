import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Portal } from "./ui/Portal";
import {
  HelpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  TerminalIcon,
  SettingsIcon,
  PlayIcon,
  StopIcon,
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  RefreshIcon,
  SparklesIcon,
  ContainerIcon,
  StoreIcon,
  LxcIcon,
  PaletteIcon,
} from "./icons";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

interface HelpDialogProps {
  onClose: () => void;
}

interface HelpSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function HelpSection({ title, icon, children, defaultOpen = false }: HelpSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-outline-variant/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-surface-container/30 hover:bg-surface-container/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-primary">{icon}</span>
          <span className="font-medium text-on-surface">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUpIcon size="sm" className="text-on-surface-variant" />
        ) : (
          <ChevronDownIcon size="sm" className="text-on-surface-variant" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 bg-surface-container-low/50 text-sm text-on-surface-variant leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

function HelpItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <h4 className="font-medium text-on-surface mb-1">{title}</h4>
      <p className="text-on-surface-variant">{children}</p>
    </div>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-1 text-on-surface-variant">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  const { t } = useTranslation("help");
  const [appVersion, setAppVersion] = useState<string>("");

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Fetch app version
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-scrim/32"
          onClick={onClose}
        />

        {/* Dialog */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-dialog-title"
          data-testid="help-dialog"
          className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-md3-3 max-w-3xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-6 border-b border-outline-variant bg-surface-container-low">
            <div className="p-2 rounded-lg bg-secondary/20">
              <HelpIcon size="lg" className="text-secondary" />
            </div>
            <div>
              <h2 id="help-dialog-title" className="text-xl font-semibold text-on-surface">
                {t('title')}
              </h2>
              <p className="text-sm text-on-surface-variant">
                {t('subtitle')}
              </p>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {/* Getting Started */}
            <HelpSection
              title={t('gettingStarted.title')}
              icon={<PlayIcon size="md" />}
              defaultOpen={true}
            >
              <HelpItem title={t('gettingStarted.whatIsBunOsWsl')}>
                {t('gettingStarted.whatIsBunOsWslText')}
              </HelpItem>
              <HelpItem title={t('gettingStarted.mainDashboard')}>
                {t('gettingStarted.mainDashboardText')}
              </HelpItem>
              <HelpItem title={t('gettingStarted.quickActions')}>
                {t('gettingStarted.quickActionsText')}
              </HelpItem>
            </HelpSection>

            {/* Distribution Management */}
            <HelpSection
              title={t('distroManagement.title')}
              icon={<TerminalIcon size="md" />}
            >
              <HelpItem title={t('distroManagement.startingStoppingTitle')}>
                <span className="flex items-center gap-2 mb-1">
                  <PlayIcon size="sm" className="text-success" /> {t('distroManagement.start')}
                </span>
                <span className="flex items-center gap-2">
                  <StopIcon size="sm" className="text-error" /> {t('distroManagement.stop')}
                </span>
              </HelpItem>
              <HelpItem title={t('distroManagement.setAsDefault')}>
                {t('distroManagement.setAsDefaultText')}
              </HelpItem>
              <HelpItem title={t('distroManagement.resourceMonitoring')}>
                {t('distroManagement.resourceMonitoringText')}
              </HelpItem>
            </HelpSection>

            {/* Advanced Operations */}
            <HelpSection
              title={t('advancedOps.title')}
              icon={<SettingsIcon size="md" />}
            >
              <HelpItem title={t('advancedOps.rename')}>
                {t('advancedOps.renameText')}
              </HelpItem>
              <HelpItem title={t('advancedOps.move')}>
                {t('advancedOps.moveText')}
              </HelpItem>
              <HelpItem title={t('advancedOps.resizeDisk')}>
                {t('advancedOps.resizeDiskText')}
              </HelpItem>
              <HelpItem title={t('advancedOps.setWslVersion')}>
                {t('advancedOps.setWslVersionText')}
              </HelpItem>
              <HelpItem title={t('advancedOps.sparseMode')}>
                {t('advancedOps.sparseModeText')}
              </HelpItem>
              <HelpItem title={t('advancedOps.compactDisk')}>
                {t('advancedOps.compactDiskText')}
              </HelpItem>
            </HelpSection>

            {/* Creating Distributions */}
            <HelpSection
              title={t('creatingDistros.title')}
              icon={<DownloadIcon size="md" />}
            >
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <StoreIcon size="md" className="text-warning mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-medium text-on-surface">{t('creatingDistros.quickInstall')}</h4>
                    <p>{t('creatingDistros.quickInstallText')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ContainerIcon size="md" className="text-secondary mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-medium text-on-surface">{t('creatingDistros.containerImages')}</h4>
                    <p>{t('creatingDistros.containerImagesText')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DownloadIcon size="md" className="text-success mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-medium text-on-surface">{t('creatingDistros.directDownload')}</h4>
                    <p>{t('creatingDistros.directDownloadText')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <LxcIcon size="md" className="text-tertiary mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-medium text-on-surface">{t('creatingDistros.communityCatalog')}</h4>
                    <p>{t('creatingDistros.communityCatalogText')}</p>
                  </div>
                </div>
              </div>
            </HelpSection>

            {/* Backup & Restore */}
            <HelpSection
              title={t('backupRestore.title')}
              icon={<CopyIcon size="md" />}
            >
              <HelpItem title={t('backupRestore.export')}>
                {t('backupRestore.exportText')}
              </HelpItem>
              <HelpItem title={t('backupRestore.import')}>
                {t('backupRestore.importText')}
              </HelpItem>
              <HelpItem title={t('backupRestore.clone')}>
                {t('backupRestore.cloneText')}
              </HelpItem>
            </HelpSection>

            {/* Custom Actions */}
            <HelpSection
              title={t('customActions.title')}
              icon={<SparklesIcon size="md" />}
            >
              <HelpItem title={t('customActions.whatAre')}>
                {t('customActions.whatAreText')}
              </HelpItem>
              <HelpItem title={t('customActions.variables')}>
                {t('customActions.variablesText')}
              </HelpItem>
              <ul className="list-none space-y-1 font-mono text-xs bg-surface-container/50 p-3 rounded-lg mt-2">
                <li><code className="text-secondary">{"${DISTRO_NAME}"}</code> - {t('customActions.varDistroName')}</li>
                <li><code className="text-secondary">{"${HOME}"}</code> - {t('customActions.varHome')}</li>
                <li><code className="text-secondary">{"${USER}"}</code> - {t('customActions.varUser')}</li>
                <li><code className="text-secondary">{"${WINDOWS_HOME}"}</code> - {t('customActions.varWindowsHome')}</li>
              </ul>
              <HelpItem title={t('customActions.targeting')}>
                {t('customActions.targetingText')}
              </HelpItem>
            </HelpSection>

            {/* Theming */}
            <HelpSection
              title={t('theming.title')}
              icon={<PaletteIcon size="md" />}
            >
              <HelpItem title={t('theming.builtinThemes')}>
                {t('theming.builtinThemesText')}
              </HelpItem>
              <HelpItem title={t('theming.accessibilityThemes')}>
                {t('theming.accessibilityThemesText')}
              </HelpItem>
              <HelpItem title={t('theming.customTheme')}>
                {t('theming.customThemeText')}
              </HelpItem>
            </HelpSection>

            {/* Keyboard Shortcuts */}
            <HelpSection
              title={t('keyboardShortcuts.title')}
              icon={<SettingsIcon size="md" />}
            >
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><kbd className="px-2 py-0.5 bg-surface-container rounded text-xs">{t('keyboardShortcuts.tab')}</kbd></div>
                  <div>{t('keyboardShortcuts.tabAction')}</div>
                  <div><kbd className="px-2 py-0.5 bg-surface-container rounded text-xs">{t('keyboardShortcuts.shiftTab')}</kbd></div>
                  <div>{t('keyboardShortcuts.shiftTabAction')}</div>
                  <div><kbd className="px-2 py-0.5 bg-surface-container rounded text-xs">{t('keyboardShortcuts.enter')}</kbd></div>
                  <div>{t('keyboardShortcuts.enterAction')}</div>
                  <div><kbd className="px-2 py-0.5 bg-surface-container rounded text-xs">{t('keyboardShortcuts.escape')}</kbd></div>
                  <div>{t('keyboardShortcuts.escapeAction')}</div>
                  <div><kbd className="px-2 py-0.5 bg-surface-container rounded text-xs">{t('keyboardShortcuts.space')}</kbd></div>
                  <div>{t('keyboardShortcuts.spaceAction')}</div>
                </div>
              </div>
              <HelpItem title={t('keyboardShortcuts.accessibility')}>
                {t('keyboardShortcuts.accessibilityText')}
              </HelpItem>
            </HelpSection>

            {/* Settings Overview */}
            <HelpSection
              title={t('settingsOverview.title')}
              icon={<SettingsIcon size="md" />}
            >
              <FeatureList items={[
                t('settingsOverview.terminal'),
                t('settingsOverview.ide'),
                t('settingsOverview.wslGlobal'),
                t('settingsOverview.perDistro'),
                t('settingsOverview.polling'),
                t('settingsOverview.timeouts'),
                t('settingsOverview.executables'),
              ]} />
            </HelpSection>

            {/* Integrations */}
            <HelpSection
              title={t('integrations.title')}
              icon={<FolderIcon size="md" />}
            >
              <HelpItem title={t('integrations.terminal')}>
                {t('integrations.terminalText')}
              </HelpItem>
              <HelpItem title={t('integrations.ide')}>
                {t('integrations.ideText')}
              </HelpItem>
              <HelpItem title={t('integrations.fileExplorer')}>
                {t('integrations.fileExplorerText')}
              </HelpItem>
              <HelpItem title={t('integrations.systemTray')}>
                {t('integrations.systemTrayText')}
              </HelpItem>
            </HelpSection>

            {/* Troubleshooting */}
            <HelpSection
              title={t('troubleshooting.title')}
              icon={<RefreshIcon size="md" />}
            >
              <HelpItem title={t('troubleshooting.wslNotDetected')}>
                {t('troubleshooting.wslNotDetectedText')}
              </HelpItem>
              <HelpItem title={t('troubleshooting.operationsTimeout')}>
                {t('troubleshooting.operationsTimeoutText')}
              </HelpItem>
              <HelpItem title={t('troubleshooting.distroWontStart')}>
                {t('troubleshooting.distroWontStartText')}
              </HelpItem>
              <div className="mt-3 pt-3 border-t border-outline-variant/30">
                <button
                  onClick={() => openUrl("https://github.com/aphrody-labs/bun-os/tree/os/docs/wsl")}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <ExternalLinkIcon size="sm" />
                  {t('troubleshooting.fullGuide')}
                </button>
              </div>
            </HelpSection>

            {/* Resources */}
            <HelpSection
              title={t('resources.title')}
              icon={<ExternalLinkIcon size="md" />}
            >
              <div className="space-y-3">
                <button
                  onClick={() => openUrl("https://github.com/aphrody-labs/bun-os/tree/os/docs/wsl")}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <ExternalLinkIcon size="sm" />
                  {t('resources.wslUiWebsite')}
                </button>
                <button
                  onClick={() => openUrl("https://github.com/aphrody-labs/bun-os")}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <ExternalLinkIcon size="sm" />
                  {t('resources.githubRepo')}
                </button>
                <button
                  onClick={() => openUrl("https://github.com/aphrody-labs/bun-os/issues")}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <ExternalLinkIcon size="sm" />
                  {t('resources.reportIssue')}
                </button>
                <button
                  onClick={() => openUrl("https://www.octasoft.co.uk")}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <ExternalLinkIcon size="sm" />
                  {t('resources.octasoftWebsite')}
                </button>
                <button
                  onClick={() => openUrl("https://docs.microsoft.com/en-us/windows/wsl/")}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <ExternalLinkIcon size="sm" />
                  {t('resources.microsoftDocs')}
                </button>
              </div>
            </HelpSection>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-outline-variant bg-surface-container/30">
            <span className="text-xs text-on-surface-variant">
              Bun OS WSL {appVersion && `v${appVersion}`}
            </span>
            <button
              onClick={onClose}
              data-testid="help-close-button"
              className="px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors"
            >
              {t('common:button.close')}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
