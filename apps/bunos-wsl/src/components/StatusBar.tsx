import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDistroStore } from "../store/distroStore";
import { useResourceStore } from "../store/resourceStore";
import { useSettingsStore } from "../store/settingsStore";
import { getDiskMountEntries, useMountStore } from "../store/mountStore";
import { useHealthStore } from "../store/healthStore";
import { usePollingStore } from "../store/pollingStore";
import { useNotificationStore } from "../store/notificationStore";
import { usePreflightStore } from "../store/preflightStore";
import { wslService } from "../services/wslService";
import { MountedDisksPanel } from "./MountedDisksPanel";

// Check if running in Tauri or browser (mock mode)
const isMockMode = (): boolean => {
  return typeof window !== "undefined" && !("__TAURI__" in window);
};

// Format bytes to human readable string
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// Health status color mapping
const healthColors = {
  stopped: "bg-outline",
  healthy: "bg-success",
  warning: "bg-warning",
  unhealthy: "bg-error",
};

const healthGlowColors = {
  stopped: "",
  healthy: "",
  warning: "",
  unhealthy: "",
};

// Minimum time to display status message (ms) - ensures users see feedback
const MIN_STATUS_DISPLAY_TIME = 800;

export function StatusBar() {
  const { t } = useTranslation("statusbar");
  const { distributions, actionInProgress, isLoading, setActionInProgress } = useDistroStore();
  const { stats: resourceStats } = useResourceStore();
  const { settings } = useSettingsStore();
  const { mountedDisks, trackedMounts, loadMountedDisks, openMountDialog } = useMountStore();
  const diskCount = getDiskMountEntries(mountedDisks, trackedMounts).length;
  const { health, versionInfo, fetchVersion } = useHealthStore();
  const { hasBackoff, getBackoffMessage } = usePollingStore();
  const { addNotification } = useNotificationStore();
  const { isReady: wslReady, status: preflightStatus, message: preflightMessage } = usePreflightStore();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showMountPanel, setShowMountPanel] = useState(false);
  const [displayedStatus, setDisplayedStatus] = useState<string | null>(null);
  const statusStartTimeRef = useRef<number | null>(null);
  const diskButtonRef = useRef<HTMLButtonElement>(null);
  const runningCount = distributions.filter((d) => d.state === "Running").length;
  const defaultDistro = distributions.find((d) => d.isDefault);
  const mockMode = isMockMode();
  const isBackedOff = hasBackoff();
  const backoffMessage = getBackoffMessage();

  // Show status immediately, but keep it visible for a minimum duration
  // This ensures users see feedback even for fast operations
  const currentStatus = actionInProgress || (isLoading ? "Syncing..." : null);
  useEffect(() => {
    if (currentStatus) {
      // Show status immediately and track start time
      setDisplayedStatus(currentStatus);
      statusStartTimeRef.current = Date.now();
    } else if (statusStartTimeRef.current !== null) {
      // Status cleared - ensure minimum display time before hiding
      const elapsed = Date.now() - statusStartTimeRef.current;
      const remaining = MIN_STATUS_DISPLAY_TIME - elapsed;

      if (remaining > 0) {
        const timer = setTimeout(() => {
          setDisplayedStatus(null);
          statusStartTimeRef.current = null;
        }, remaining);
        return () => clearTimeout(timer);
      } else {
        setDisplayedStatus(null);
        statusStartTimeRef.current = null;
      }
    }
  }, [currentStatus]);

  // Load mounted disks when WSL is ready
  useEffect(() => {
    if (wslReady) {
      loadMountedDisks();
    }
  }, [wslReady, loadMountedDisks]);

  // Handle WSL update
  const handleUpdate = async () => {
    setIsUpdating(true);
    setActionInProgress("Updating WSL...");
    try {
      // Pass current version for before/after comparison
      const result = await wslService.updateWsl(settings.usePreReleaseUpdates, versionInfo?.wslVersion);
      // Show success notification
      addNotification({
        type: "success",
        title: "WSL Update",
        message: result || "Update completed successfully",
        autoDismiss: 5000,
      });
      // Refresh version info after update
      fetchVersion();
    } catch (error) {
      // Tauri errors can be strings, Error objects, or objects with message property
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : (error as { message?: string })?.message || "Update failed";
      const isCancelled = message.toLowerCase().includes("cancelled");
      // User cancellation is a warning with auto-dismiss; real errors stay visible
      addNotification({
        type: isCancelled ? "warning" : "error",
        title: isCancelled ? "WSL Update" : "WSL Update Failed",
        message,
        autoDismiss: isCancelled ? 3000 : 0,
      });
    } finally {
      setIsUpdating(false);
      setActionInProgress(null);
    }
  };

  // Build tooltip for version info
  const versionTooltip = versionInfo
    ? `WSL version: ${versionInfo.wslVersion}\nKernel: ${versionInfo.kernelVersion}\nWSLg: ${versionInfo.wslgVersion}\nWindows: ${versionInfo.windowsVersion}`
    : "Loading...";

  // Calculate memory stats
  const memoryStats = resourceStats && resourceStats.perDistro.length > 0 ? (() => {
    const totalMemory = resourceStats.perDistro.reduce((sum, d) => sum + d.memoryUsedBytes, 0);
    const memoryLimit = resourceStats.global.memoryLimitBytes;
    return { totalMemory, memoryLimit };
  })() : null;

  return (
    <footer data-testid="status-bar" className="relative px-6 py-2 border-t border-outline-variant bg-surface-container">

      <div className="flex items-center justify-between gap-4">
        {/* Left: System telemetry */}
        <div className="flex items-center gap-6 min-w-0">
          {/* Status indicator - single light for health/connection status */}
          {/* Priority: backoff > preflight failure > health status */}
          <div
            className="cursor-help"
            title={
              isBackedOff
                ? (backoffMessage || "Connection issues - auto-refresh slowed")
                : !wslReady && preflightStatus
                  ? `WSL Not Ready: ${preflightMessage}`
                  : (health?.message || "Loading...")
            }
          >
            <div className={`w-2.5 h-2.5 rounded-full ${
              isBackedOff
                ? "bg-warning animate-pulse"
                : !wslReady && preflightStatus
                  ? `${healthColors.unhealthy} ${healthGlowColors.unhealthy}`
                  : health
                    ? `${healthColors[health.status]} ${healthGlowColors[health.status]}`
                    : "bg-outline"
            }`} />
          </div>

          {/* WSL Version */}
          <div className="flex items-center gap-2">
            <span className="data-label">{t('wsl')}</span>
            <span
              className="data-value text-xs text-primary cursor-help"
              title={versionTooltip}
            >
              v{versionInfo?.wslVersion || "..."}
            </span>
            <button
              onClick={handleUpdate}
              disabled={isUpdating}
              data-testid="wsl-update-button"
              className="p-1 rounded hover:bg-surface-container transition-colors disabled:opacity-50 disabled:cursor-not-allowed group min-w-[44px] flex justify-center"
              title={
                isUpdating
                  ? t('updateWsl.updating')
                  : settings.usePreReleaseUpdates
                    ? t('updateWsl.preRelease')
                    : t('updateWsl.default')
              }
            >
              {isUpdating ? (
                <div className="flex items-center gap-1" data-testid="wsl-update-spinner">
                  <div className="w-3 h-3 border border-warning border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-warning font-medium animate-pulse">{t('updateWsl.uac')}</span>
                </div>
              ) : (
                <svg className="w-3 h-3 text-on-surface-variant group-hover:text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 0 0-9-9M3 12a9 9 0 0 0 9 9m0-18v6m0 12v-6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 3l3 3-3 3M12 21l-3-3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>

          {/* Disk Mount Button */}
          <div className="relative">
            <button
              ref={diskButtonRef}
              onClick={() => setShowMountPanel(!showMountPanel)}
              data-testid="disk-mounts-button"
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-container transition-colors group"
              title={diskCount > 0 ? t('diskMounts.count', { count: diskCount }) : t('diskMounts.empty')}
            >
              <svg className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="data-label group-hover:text-on-surface">{t('disk')}</span>
              {diskCount > 0 && (
                <span className="data-value text-xs text-primary">
                  {diskCount}
                </span>
              )}
            </button>
            <MountedDisksPanel
              isOpen={showMountPanel}
              onClose={() => setShowMountPanel(false)}
              onMountNew={openMountDialog}
              anchorRef={diskButtonRef}
            />
          </div>

          {/* Divider */}
          <div className="w-px h-4 bg-outline-variant" />

          {/* Distribution stats */}
          <div className="flex items-center gap-4">
            {mockMode && (
              <span className="px-2 py-0.5 bg-warning/10 text-warning rounded text-xs font-mono font-semibold border border-warning/30 uppercase tracking-wider">
                {t('dev')}
              </span>
            )}

            <div className="flex items-center gap-2">
              <span className="data-label">{t('instances')}</span>
              <span className="data-value text-xs text-on-surface-variant">{distributions.length}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="data-label">{t('active')}</span>
              <span className={`data-value text-xs ${runningCount > 0 ? 'text-success' : 'text-on-surface-variant'}`}>
                {runningCount}
              </span>
            </div>

            {memoryStats && memoryStats.totalMemory > 0 && (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="data-label">{t('mem')}</span>
                <span className="data-value text-xs text-on-surface-variant">
                  {formatBytes(memoryStats.totalMemory)}
                </span>
              </div>
            )}

            {defaultDistro && (
              <div className="hidden lg:flex items-center gap-2">
                <span className="data-label">{t('primary')}</span>
                <span className="data-value text-xs text-primary">{defaultDistro.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Status - fixed width to prevent jumping */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="relative z-10 flex items-center gap-3 shrink-0 justify-end bg-surface pl-3 w-60"
        >
          {displayedStatus ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-3 h-3 shrink-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span
                className="data-value text-xs text-primary truncate"
                title={displayedStatus}
              >
                {displayedStatus}
              </span>
            </div>
          ) : runningCount > 0 ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 shrink-0 rounded-full bg-success animate-pulse" />
              <span className="data-value text-xs text-success">{t('common:status.operational')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 shrink-0 rounded-full bg-outline" />
              <span className="data-value text-xs text-on-surface-variant">{t('common:status.standby')}</span>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
