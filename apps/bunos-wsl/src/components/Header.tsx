import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { useDistroStore } from "../store/distroStore";
import { ImportDialog } from "./ImportDialog";
import { NewDistroDialog } from "./NewDistroDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { PlusIcon, DownloadIcon, RefreshIcon, ShutdownIcon, SettingsIcon, TerminalWindowIcon, HelpIcon } from "./icons";
import { HelpDialog } from "./HelpDialog";
import { AppMark } from "./AppMark";
import { Button, IconButton } from "./ui/Button";
import { wslService, SystemDistroInfo } from "../services/wslService";

interface HeaderProps {
  onOpenSettings: () => void;
}

export function Header({ onOpenSettings }: HeaderProps) {
  const { t } = useTranslation("header");
  const { shutdownAll, fetchDistros, openSystemTerminal, isLoading, actionInProgress, distributions } = useDistroStore();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemDistroInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [prevDistroCount, setPrevDistroCount] = useState<number | null>(null);

  // Fetch system distro info helper
  const fetchSystemInfo = () => {
    wslService.getSystemDistroInfo()
      .then(setSystemInfo)
      .catch(() => setSystemInfo(null));
  };

  // Fetch system distro info and app version on mount
  useEffect(() => {
    fetchSystemInfo();
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  // Re-fetch system info when transitioning between 0 and 1+ distros
  useEffect(() => {
    const currentCount = distributions.length;

    // Skip the initial render (when prevDistroCount is null)
    if (prevDistroCount !== null) {
      // Detect 0→1 or 1→0 transitions
      const wasEmpty = prevDistroCount === 0;
      const isEmpty = currentCount === 0;

      if (wasEmpty !== isEmpty) {
        fetchSystemInfo();
      }
    }

    setPrevDistroCount(currentCount);
  }, [distributions.length]);

  const handleShutdownAll = async () => {
    setShowShutdownConfirm(false);
    await shutdownAll();
  };

  return (
    <>
      <header className="relative flex items-center justify-between px-6 py-3 border-b border-outline-variant bg-surface-container">
        {/* Ambient glow effect */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-32 bg-primary/5 blur-3xl rounded-full" />
          <div className="absolute top-0 right-1/4 w-64 h-24 bg-tertiary/5 blur-3xl rounded-full" />
        </div>

        {/* Left: Logo, title, and system info */}
        <div className="relative flex items-center gap-6">
          {/* Logo and title */}
          <div className="flex items-center gap-4">
            <AppMark size={33} />

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-on-surface">
                  Bun OS <span className="font-bold text-primary">WSL</span>
                </h1>
                {appVersion && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-secondary-container text-on-secondary-container rounded-full border border-outline-variant">
                    v{appVersion}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-on-surface-variant tracking-wider uppercase whitespace-nowrap">
                {t('subtitle')}
              </p>
            </div>
          </div>

          {/* System Distro Info Box - hidden below lg breakpoint */}
          {systemInfo && (
            <div className="hidden lg:flex items-center gap-4">
              {/* Divider */}
              <div className="w-px h-8 bg-outline-variant" />

              <div
                className="px-2.5 py-1 bg-surface-container/50 border border-outline-variant rounded-md cursor-help"
                title={`WSL2 System Distribution\n${systemInfo.name}\nVersion: ${systemInfo.version}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-on-surface-variant font-mono">SYS</span>
                  <span className="text-[10px] text-primary font-mono font-medium">
                    {systemInfo.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-on-surface-variant font-mono">VER</span>
                  <span className="text-[10px] text-on-surface-variant font-mono">
                    {systemInfo.version}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Action buttons */}
        <div className="relative flex items-center gap-3">
          {/* Primary action - New */}
          <Button
            variant="success"
            size="sm"
            className="btn-cyber"
            icon={<PlusIcon size="sm" />}
            onClick={() => setShowNewDialog(true)}
            disabled={isLoading || !!actionInProgress}
            data-testid="new-distro-button"
          >
            {t('button.new')}
          </Button>

          {/* Secondary actions */}
          <Button
            variant="accent"
            size="sm"
            className="btn-cyber"
            icon={<DownloadIcon size="sm" />}
            onClick={() => setShowImportDialog(true)}
            disabled={isLoading || !!actionInProgress}
            data-testid="import-button"
          >
            {t('button.import')}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            className="btn-cyber"
            icon={<RefreshIcon size="sm" className={isLoading ? "animate-spin" : ""} />}
            onClick={() => fetchDistros(false, true)}
            disabled={isLoading || !!actionInProgress}
            data-testid="refresh-button"
          >
            {t('button.sync')}
          </Button>

          {/* Danger action */}
          <Button
            variant="danger"
            size="sm"
            className="btn-cyber"
            icon={<ShutdownIcon size="sm" />}
            onClick={() => setShowShutdownConfirm(true)}
            disabled={isLoading || !!actionInProgress}
            data-testid="shutdown-all-button"
          >
            {t('button.shutdown')}
          </Button>

          {/* Divider */}
          <div className="w-px h-8 bg-outline-variant mx-1" />

          {/* System Terminal */}
          <IconButton
            icon={<TerminalWindowIcon size="md" />}
            label={t('button.systemTerminal')}
            variant="ghost"
            colorScheme="tertiary"
            onClick={() => openSystemTerminal()}
            disabled={isLoading || !!actionInProgress}
            data-testid="system-terminal-button"
          />

          {/* Help */}
          <IconButton
            icon={<HelpIcon size="md" />}
            label={t('button.help')}
            variant="ghost"
            onClick={() => setShowHelpDialog(true)}
            data-testid="help-button"
          />

          {/* Settings */}
          <IconButton
            icon={<SettingsIcon size="md" />}
            label={t('button.settings')}
            variant="ghost"
            onClick={onOpenSettings}
            data-testid="settings-button"
          />
        </div>
      </header>

      <ImportDialog isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} />
      <NewDistroDialog isOpen={showNewDialog} onClose={() => setShowNewDialog(false)} />
      <ConfirmDialog
        isOpen={showShutdownConfirm}
        title={t('shutdownAll.title')}
        message={t('shutdownAll.message')}
        confirmLabel={t('shutdownAll.confirm')}
        onConfirm={handleShutdownAll}
        onCancel={() => setShowShutdownConfirm(false)}
        danger
      />
      {showHelpDialog && <HelpDialog onClose={() => setShowHelpDialog(false)} />}
    </>
  );
}

