import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { wslService, type DownloadProgress } from "../services/wslService";
import { useDistroStore } from "../store/distroStore";
import { useSettingsStore } from "../store/settingsStore";
import { useReviewPrompt } from "../hooks/useReviewPrompt";
import { CheckIcon, DownloadIcon, StoreIcon, SourceDownloadIcon, LxcIcon, ContainerIcon, CloseIcon } from "./icons";
import { getDistroLogo, DockerLogo, LinuxLogo } from "./icons/DistroLogos";
import type { DistroCatalog, DownloadDistro, ContainerImage, DistroFamily } from "../types/catalog";
import { getDistroFamily, DISTRO_FAMILY_NAMES } from "../types/catalog";
import type { LxcDistribution } from "../types/lxcCatalog";
import { LxcCatalogBrowser } from "./LxcCatalogBrowser";
import { Portal } from "./ui/Portal";
import { Button, IconButton } from "./ui/Button";
import { InstallConfigDialog, type InstallConfig } from "./InstallConfigDialog";

// Note: Backend now handles metadata creation for all install operations.
// Frontend no longer needs to call saveInstallMetadata.

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

interface NewDistroDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type InstallMode = "quick" | "custom" | "community" | "container";

// Mode config uses keys for i18n lookup - labels are resolved at render time
const MODE_CONFIG = {
  quick: {
    labelKey: "mode.quickInstall",
    descriptionKey: "mode.quickInstallDesc",
    color: "emerald",
    Icon: StoreIcon,
  },
  community: {
    labelKey: "mode.community",
    descriptionKey: "mode.communityDesc",
    color: "purple",
    Icon: LxcIcon,
  },
  container: {
    labelKey: "mode.container",
    descriptionKey: "mode.containerDesc",
    color: "orange",
    Icon: ContainerIcon,
  },
  custom: {
    labelKey: "mode.download",
    descriptionKey: "mode.downloadDesc",
    color: "blue",
    Icon: SourceDownloadIcon,
  },
} as const;

// Pending install item for config dialog
interface PendingInstallItem {
  name: string;
  suggestedName: string;
  description?: string;
}

export function NewDistroDialog({ isOpen, onClose }: NewDistroDialogProps) {
  const { t } = useTranslation("install");
  const [mode, setMode] = useState<InstallMode>("quick");
  const [catalog, setCatalog] = useState<DistroCatalog | null>(null);
  const [onlineDistros, setOnlineDistros] = useState<string[]>([]);
  const [loadingDistros, setLoadingDistros] = useState(false);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const [catalogReload, setCatalogReload] = useState(0);
  const [selectedDistro, setSelectedDistro] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<ContainerImage | null>(null);
  const [selectedLxcDistro, setSelectedLxcDistro] = useState<LxcDistribution | null>(null);
  const [customImage, setCustomImage] = useState("");
  const [useCustomImage, setUseCustomImage] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [useCustomUrl, setUseCustomUrl] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [nativeInstallStartedAt, setNativeInstallStartedAt] = useState<number | null>(null);
  const [nativeInstallElapsedSeconds, setNativeInstallElapsedSeconds] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [familyFilter, setFamilyFilter] = useState<DistroFamily | null>(null);
  // Install config dialog state
  const [showInstallConfig, setShowInstallConfig] = useState(false);
  const [pendingInstallItem, setPendingInstallItem] = useState<PendingInstallItem | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastProgressUpdateRef = useRef<number>(0);
  const { fetchDistros, distributions } = useDistroStore();
  const { settings } = useSettingsStore();
  const { markFirstInstallComplete } = useReviewPrompt();

  // Throttled progress update - only update every 100ms to reduce re-renders
  const throttledSetProgress = useCallback((msg: string) => {
    const now = Date.now();
    if (now - lastProgressUpdateRef.current > 100) {
      lastProgressUpdateRef.current = now;
      setProgress(msg);
    }
  }, []);

  // Get enabled download distros from catalog (sorted alphabetically)
  const downloadableDistros = (catalog?.downloadDistros.filter(d => d.enabled) || [])
    .sort((a, b) => a.name.localeCompare(b.name));

  // Get enabled container images from catalog (sorted alphabetically)
  const containerImages = (catalog?.containerImages.filter(i => i.enabled) || [])
    .sort((a, b) => a.name.localeCompare(b.name));

  // Get enabled online distros (filtered by MS Store metadata enabled status, sorted alphabetically)
  const enabledOnlineDistros = onlineDistros
    .filter(distro => {
      const info = catalog?.msStoreDistros[distro];
      // Include if no metadata exists OR if enabled is not explicitly false
      return !info || info.enabled !== false;
    })
    .sort((a, b) => a.localeCompare(b));

  // Get MS Store metadata from catalog
  const getMsStoreInfo = (distroId: string) => {
    const info = catalog?.msStoreDistros[distroId];
    if (info) {
      return { description: info.description };
    }
    return { description: "" };
  };

  // Get download distro info from catalog
  const getDownloadInfo = (distroId: string): DownloadDistro | undefined => {
    return downloadableDistros.find(d => d.id === distroId);
  };

  // Refresh on each open so a failed request or changed source is not cached forever.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadingDistros(true);
    setCatalogLoadError(null);
    setSelectedDistro(null);
    Promise.allSettled([
      wslService.getDistroCatalog(),
      wslService.listOnlineDistributions(),
      new Promise(resolve => setTimeout(resolve, 600)),
    ]).then(([catalogResult, onlineResult]) => {
      if (cancelled) return;
      setCatalog(catalogResult.status === "fulfilled" ? catalogResult.value : null);
      setOnlineDistros(onlineResult.status === "fulfilled" ? onlineResult.value : []);
      const failures = [catalogResult, onlineResult].filter(result => result.status === "rejected");
      if (failures.length) {
        const details = failures.map(result => {
          const reason = result.reason;
          return reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
        }).filter(Boolean);
        setCatalogLoadError(details.join("\n") || t('catalogLoadFailed'));
      }
      setLoadingDistros(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, catalogReload]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (nativeInstallStartedAt === null) return;

    const updateElapsed = () => {
      setNativeInstallElapsedSeconds(
        Math.floor((Date.now() - nativeInstallStartedAt) / 1000)
      );
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [nativeInstallStartedAt]);

  // Scroll to top when progress starts to ensure user sees progress indicator
  useEffect(() => {
    if (progress && contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [progress]);

  if (!isOpen) return null;

  // Handle native WSL quick install - no config dialog needed
  const handleQuickInstall = async () => {
    setError(null);

    if (!selectedDistro) {
      setError(t('errorNoDistro'));
      return;
    }

    const exists = distributions.some(
      (d) => d.name.toLowerCase() === selectedDistro.toLowerCase()
    );
    if (exists) {
      setError(t('alreadyInstalled', { name: selectedDistro }));
      return;
    }

    setIsCreating(true);
    setNativeInstallElapsedSeconds(0);
    setNativeInstallStartedAt(Date.now());
    setProgress(t('progress.installingWsl'));

    try {
      await wslService.quickInstallDistribution(selectedDistro);
      setProgress(t('progress.success'));
      await fetchDistros();
      await markFirstInstallComplete();

      if (closeTimeoutRef.current !== null) {
        clearTimeout(closeTimeoutRef.current);
      }
      closeTimeoutRef.current = window.setTimeout(() => {
        handleClose();
        closeTimeoutRef.current = null;
      }, 1000);
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : t('errorInstallFailed');
      setError(errorMessage);
      setProgress(null);
    } finally {
      setNativeInstallStartedAt(null);
      setIsCreating(false);
    }
  };

  // Handle install from config dialog (community, container, download modes)
  const handleInstallFromConfig = async (config: InstallConfig) => {
    setError(null);
    setShowInstallConfig(false);

    if (mode === "custom") {
      const url = useCustomUrl ? customUrl.trim() : (selectedDistro ? getDownloadInfo(selectedDistro)?.url : undefined);
      if (!url) return;

      setIsCreating(true);
      setProgress(t('downloadStarting'));
      setDownloadProgress(null);

      const unlisten = await wslService.onDownloadProgress((progress) => {
        if (progress.distroName === config.distroName) {
          setDownloadProgress(progress);
          if (progress.stage === "downloading") {
            const percent = progress.percent != null ? Math.round(progress.percent) : 0;
            const downloaded = formatBytes(progress.bytesDownloaded);
            const total = progress.totalBytes ? formatBytes(progress.totalBytes) : "?";
            throttledSetProgress(t('progress.downloading', { percent, downloaded, total }));
          } else if (progress.stage === "importing") {
            setProgress(t('progress.importing'));
          } else if (progress.stage === "complete") {
            setProgress(t('progress.success'));
          } else if (progress.stage === "error") {
            setProgress(null);
            setError(t('progress.downloadFailed'));
          }
        }
      });
      unlistenRef.current = unlisten;

      try {
        if (useCustomUrl) {
          await wslService.installFromRootfsUrl(
            url,
            config.distroName,
            config.installLocation,
            config.wslVersion,
          );
        } else {
          await wslService.customInstallWithProgress(
            selectedDistro!,
            config.distroName,
            config.installLocation,
            config.wslVersion,
          );
        }
        setProgress(t('progress.success'));

        // Save custom URL to catalog for future use
        if (useCustomUrl && url) {
          const urlExists = downloadableDistros.some(d => d.url === url);
          if (!urlExists) {
            try {
              const urlObj = new URL(url);
              const filename = urlObj.pathname.split('/').pop() || 'custom';
              const suggestedName = filename.replace(/\.(tar\.gz|tar\.xz|tar|rootfs)$/i, '').replace(/[^a-zA-Z0-9]/g, '-');
              const newDownloadDistro: DownloadDistro = {
                id: `custom-${Date.now()}`,
                name: suggestedName || t('customDistribution'),
                description: url,
                url: url,
                enabled: true,
              };
              const updatedCatalog = await wslService.addDownloadDistro(newDownloadDistro);
              setCatalog(updatedCatalog);
            } catch {
              // Silently ignore
            }
          }
        }

        setSelectedDistro(null);
        setCustomUrl("");
        setUseCustomUrl(false);
        await fetchDistros();
        await markFirstInstallComplete();

        if (closeTimeoutRef.current !== null) {
          clearTimeout(closeTimeoutRef.current);
        }
        closeTimeoutRef.current = window.setTimeout(() => {
          handleClose();
          closeTimeoutRef.current = null;
        }, 1000);
      } catch (err) {
        const errorMessage = err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : t('errorInstallFailed');
        setError(errorMessage);
        setProgress(null);
      } finally {
        setIsCreating(false);
        setDownloadProgress(null);
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
      }
    } else if (mode === "community" && selectedLxcDistro) {
      setIsCreating(true);
      setProgress(t('downloading', { name: selectedLxcDistro.name, release: selectedLxcDistro.releaseTitle }));
      setDownloadProgress(null);

      const unlisten = await wslService.onDownloadProgress((progress) => {
        if (progress.distroName === config.distroName) {
          setDownloadProgress(progress);
          if (progress.stage === "downloading") {
            const percent = progress.percent != null ? Math.round(progress.percent) : 0;
            const downloaded = formatBytes(progress.bytesDownloaded);
            const total = progress.totalBytes ? formatBytes(progress.totalBytes) : formatBytes(selectedLxcDistro.sizeBytes);
            throttledSetProgress(t('progress.downloading', { percent, downloaded, total }));
          } else if (progress.stage === "importing") {
            setProgress(t('progress.importing'));
          } else if (progress.stage === "complete") {
            setProgress(t('progress.success'));
          } else if (progress.stage === "error") {
            setProgress(null);
            setError(t('progress.downloadFailed'));
          }
        }
      });
      unlistenRef.current = unlisten;

      try {
        await wslService.installFromRootfsUrl(
          selectedLxcDistro.downloadUrl,
          config.distroName,
          config.installLocation,
          config.wslVersion,
        );
        setProgress(t('progress.success'));
        setSelectedLxcDistro(null);
        await fetchDistros();
        await markFirstInstallComplete();

        if (closeTimeoutRef.current !== null) {
          clearTimeout(closeTimeoutRef.current);
        }
        closeTimeoutRef.current = window.setTimeout(() => {
          handleClose();
          closeTimeoutRef.current = null;
        }, 1000);
      } catch (err) {
        const errorMessage = err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : t('errorInstallFailed');
        setError(errorMessage);
        setProgress(null);
      } finally {
        setIsCreating(false);
        setDownloadProgress(null);
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
      }
    } else if (mode === "container") {
      const image = useCustomImage ? customImage.trim() : selectedContainer?.image;
      if (!image) return;

      setIsCreating(true);
      setProgress(t('progress.pullingImage'));

      try {
        await wslService.createFromImage(
          image,
          config.distroName,
          config.installLocation,
          config.wslVersion,
        );
        setProgress(t('progress.success'));

        // Save custom image to catalog for future use
        if (useCustomImage && image) {
          const imageExists = containerImages.some(ci => ci.image === image);
          if (!imageExists) {
            try {
              const imageInfo = await wslService.parseImageReference(image);
              const newContainerImage: ContainerImage = {
                id: `custom-${Date.now()}`,
                name: imageInfo.suggestedName,
                description: imageInfo.fullReference,
                image: image,
                enabled: true,
              };
              const updatedCatalog = await wslService.addContainerImage(newContainerImage);
              setCatalog(updatedCatalog);
            } catch {
              // Silently ignore
            }
          }
        }

        setSelectedContainer(null);
        setCustomImage("");
        setUseCustomImage(false);
        await fetchDistros();
        await markFirstInstallComplete();

        if (closeTimeoutRef.current !== null) {
          clearTimeout(closeTimeoutRef.current);
        }
        closeTimeoutRef.current = window.setTimeout(() => {
          handleClose();
          closeTimeoutRef.current = null;
        }, 1000);
      } catch (err) {
        const errorMessage = err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : t('errorCreateFailed');
        setError(errorMessage);
        setProgress(null);
      } finally {
        setIsCreating(false);
      }
    }
  };

  const handleClose = () => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setSelectedDistro(null);
    setSelectedContainer(null);
    setSelectedLxcDistro(null);
    setCustomImage("");
    setUseCustomImage(false);
    setCustomUrl("");
    setUseCustomUrl(false);
    setShowInstallConfig(false);
    setPendingInstallItem(null);
    setError(null);
    setProgress(null);
    setDownloadProgress(null);
    onClose();
  };

  // Open config dialog for download mode
  const handleSelectDistroForDownload = (distroId: string) => {
    const info = getDownloadInfo(distroId);
    setSelectedDistro(distroId);
    setUseCustomUrl(false);
    setPendingInstallItem({
      name: info?.name || distroId,
      suggestedName: distroId.replace(/[^a-zA-Z0-9_-]/g, "-"),
      description: info?.description,
    });
    setShowInstallConfig(true);
  };

  // Open config dialog for custom URL
  const handleSelectCustomUrl = () => {
    if (!customUrl.trim()) return;
    // Parse before mutating any state: an uncaught throw in an event handler
    // is not caught by the render ErrorBoundary and left the dialog in an
    // inconsistent half-selected state (GH #136)
    let urlObj: URL;
    try {
      urlObj = new URL(customUrl.trim());
      // The backend only downloads over HTTP(S); reject other schemes here
      // rather than sending the user through the install-config flow first.
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        throw new Error("Unsupported URL protocol");
      }
    } catch {
      setError(t('customUrl.invalid', { url: customUrl.trim() }));
      return;
    }
    setError(null);
    setUseCustomUrl(true);
    setSelectedDistro(null);
    const filename = urlObj.pathname.split('/').pop() || 'custom';
    const suggestedName = filename.replace(/\.(tar\.gz|tar\.xz|tar|rootfs)$/i, '').replace(/[^a-zA-Z0-9]/g, '-');
    setPendingInstallItem({
      name: t('customUrlName'),
      suggestedName: suggestedName || "custom-distro",
      description: customUrl.trim(),
    });
    setShowInstallConfig(true);
  };

  // Open config dialog for container mode
  const handleSelectContainer = (image: ContainerImage) => {
    setSelectedContainer(image);
    setUseCustomImage(false);
    setPendingInstallItem({
      name: image.name,
      suggestedName: image.name.split(" ")[0].toLowerCase(),
      description: image.image,
    });
    setShowInstallConfig(true);
  };

  // Open config dialog for custom image
  const handleSelectCustomImage = async () => {
    if (!customImage.trim()) return;
    setUseCustomImage(true);
    setSelectedContainer(null);
    try {
      const info = await wslService.parseImageReference(customImage.trim());
      setPendingInstallItem({
        name: t('customImageName'),
        suggestedName: info.suggestedName,
        description: info.fullReference,
      });
    } catch {
      setPendingInstallItem({
        name: t('customImageName'),
        suggestedName: "custom-container",
        description: customImage.trim(),
      });
    }
    setShowInstallConfig(true);
  };

  // Open config dialog for LXC distro
  const handleSelectLxcDistro = (distro: LxcDistribution) => {
    setSelectedLxcDistro(distro);
    const baseName = distro.name.toLowerCase().replace(/\s+/g, "-");
    const version = distro.version.replace(/[^a-zA-Z0-9]/g, "");
    setPendingInstallItem({
      name: `${distro.name} ${distro.releaseTitle}`,
      suggestedName: `${baseName}-${version}`,
      description: `${distro.arch} - ${formatBytes(distro.sizeBytes)}`,
    });
    setShowInstallConfig(true);
  };

  // Select distro for native WSL quick install - no config dialog
  const handleSelectQuickInstallDistro = (distro: string) => {
    setSelectedDistro(distro);
  };

  const handleModeChange = (newMode: InstallMode) => {
    setMode(newMode);
    setSelectedDistro(null);
    setSelectedContainer(null);
    setSelectedLxcDistro(null);
    setShowInstallConfig(false);
    setPendingInstallItem(null);
    // Don't reset customUrl/useCustomUrl or customImage/useCustomImage - preserve state
    setError(null);
    setFamilyFilter(null);
  };

  // Calculate if can install (only for quick mode - other modes use config dialog)
  const canQuickInstall = !isCreating && mode === "quick" && !!selectedDistro;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto py-4">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-scrim/32 transition-opacity"
          onClick={handleClose}
        />

        {/* Dialog */}
        <div
          role="dialog"
          aria-modal="true"
          data-testid="new-distro-dialog"
          className="relative bg-surface-container-low border border-outline-variant rounded-2xl shadow-md3-3 max-w-4xl w-full mx-4 max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden animate-fade-slide-in"
        >


          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-2xl font-semibold text-on-surface">{t('title')}</h2>
              <IconButton
                icon={<CloseIcon size="md" />}
                label={t('common:button.close')}
                variant="ghost"
                onClick={handleClose}
              />
            </div>
            <p className="text-sm text-on-surface-variant">{t('subtitle')}</p>
          </div>

          {/* Mode Selector - Card style */}
          <div className="px-6 pb-4">
            <div className="grid grid-cols-4 gap-2">
              {(Object.entries(MODE_CONFIG) as [InstallMode, typeof MODE_CONFIG.quick][]).map(([key, config]) => {
                const isActive = mode === key;
                const colorClasses = {
                  emerald: isActive ? "border-success/50 bg-success/10" : "border-outline-variant hover:border-success/30",
                  blue: isActive ? "border-secondary/50 bg-secondary/10" : "border-outline-variant hover:border-secondary/30",
                  purple: isActive ? "border-tertiary/50 bg-tertiary/10" : "border-outline-variant hover:border-tertiary/30",
                  orange: isActive ? "border-primary/50 bg-primary/10" : "border-outline-variant hover:border-primary/30",
                }[config.color];
                const iconColor = {
                  emerald: isActive ? "text-success" : "text-on-surface-variant",
                  blue: isActive ? "text-secondary" : "text-on-surface-variant",
                  purple: isActive ? "text-tertiary" : "text-on-surface-variant",
                  orange: isActive ? "text-primary" : "text-on-surface-variant",
                }[config.color];

                // Map mode keys to data-testid values
                const testIdMap: Record<InstallMode, string> = {
                  quick: "quick-install",
                  custom: "download",
                  community: "lxc",
                  container: "container",
                };

                return (
                  <button
                    key={key}
                    data-testid={`new-distro-tab-${testIdMap[key]}`}
                    onClick={() => handleModeChange(key)}
                    disabled={isCreating}
                    className={`relative p-4 rounded-xl border transition-all duration-200 text-left group ${colorClasses} disabled:opacity-50`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg bg-surface-container ${iconColor} transition-colors`}>
                        <config.Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-on-surface text-sm">{t(config.labelKey)}</div>
                        <div className="text-xs text-on-surface-variant mt-0.5 leading-tight">{t(config.descriptionKey)}</div>
                      </div>
                    </div>
                    {isActive && (
                      <div className="absolute top-2 right-2">
                        <CheckIcon size="sm" className={iconColor} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Download info - for download mode, shown above name input */}
          {mode === "custom" && (
            <div className="px-6 pb-3">
              <div className="p-3 bg-secondary/10 border border-secondary/20 rounded-xl flex items-start gap-3">
                <svg className="w-5 h-5 text-secondary shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-secondary">
                  {t('info.download')}
                </p>
              </div>
            </div>
          )}

          {/* Community info - for community mode when enabled, shown above name input */}
          {mode === "community" && settings.distributionSources.lxcEnabled && (
            <div className="px-6 pb-3">
              <div className="p-3 bg-tertiary/10 border border-tertiary/20 rounded-xl flex items-start gap-3">
                <svg className="w-5 h-5 text-tertiary shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-tertiary">
                  {t('info.community', { url: settings.distributionSources.lxcBaseUrl })}
                </p>
              </div>
            </div>
          )}

          {/* Container runtime info - for container mode, shown above name input */}
          {mode === "container" && (
            <div className="px-6 pb-3">
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-start gap-3">
                <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-primary">
                  {t('info.container', {
                    runtime: (() => {
                      const runtime = settings.containerRuntime;
                      if (runtime === "builtin") return t('containerRuntime.builtin');
                      if (runtime === "docker") return t('containerRuntime.docker');
                      if (runtime === "podman") return t('containerRuntime.podman');
                      if (typeof runtime === "object" && "custom" in runtime) return t('containerRuntime.custom', { path: runtime.custom });
                      return t('containerRuntime.builtin');
                    })()
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto px-6 pb-4">
            {catalogLoadError && (
              <div role="alert" className="mb-4 p-4 rounded-xl border border-error text-error text-sm">
                <p className="font-medium">{t('catalogLoadFailed')}</p>
                <p className="mt-1 whitespace-pre-wrap">{catalogLoadError}</p>
                <p className="mt-2">{t('catalogRetryHint')}</p>
                <Button variant="secondary" className="mt-3" onClick={() => setCatalogReload(value => value + 1)} disabled={loadingDistros || isCreating}>
                  {t('common:button.retry')}
                </Button>
              </div>
            )}
            {/* Error Message */}
            {error && (
              <div
                data-testid="install-error"
                className="mb-4 p-4 bg-error/10 border border-error/30 rounded-xl text-error text-sm flex items-start gap-3"
              >
                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span data-testid="install-error-text">{error}</span>
              </div>
            )}

            {/* Progress */}
            {progress && (
              <div
                data-testid="install-progress"
                data-stage={downloadProgress?.stage || (progress.toLowerCase().includes("success") ? "complete" : "working")}
                className="mb-4 p-4 bg-surface-container border border-outline-variant rounded-xl"
              >
                <div className="flex items-center gap-3">
                  {isCreating ? (
                    <div className="relative w-8 h-8">
                      <svg className="w-8 h-8 animate-spin text-primary" viewBox="0 0 24 24">
                        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                      <CheckIcon size="md" className="text-success" />
                    </div>
                  )}
                  <div className="flex-1">
                    <p data-testid="install-progress-text" className="text-sm text-on-surface font-medium">{progress}</p>
                    {nativeInstallStartedAt !== null && (
                      <p data-testid="native-install-details" className="mt-1 text-xs text-on-surface-variant">
                        {t('progress.nativeInstallDetails', {
                          elapsed: formatElapsed(nativeInstallElapsedSeconds),
                        })}
                      </p>
                    )}
                    {downloadProgress?.stage === "downloading" && downloadProgress.percent != null && (
                      <div className="mt-2">
                        <div className="h-1.5 bg-outline-variant rounded-full overflow-hidden">
                          <div
                            data-testid="install-progress-bar"
                            data-percent={Math.round(downloadProgress.percent)}
                            className="h-full bg-primary transition-all duration-200 rounded-full"
                            style={{ width: `${Math.min(downloadProgress.percent, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Quick Install Mode */}
            {mode === "quick" && (
              <div className="min-h-[320px]">
                {/* Info hint */}
                <div className="mb-4 p-3 bg-success/10 border border-success/20 rounded-xl flex items-start gap-3">
                  <svg className="w-5 h-5 text-success shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-success">
                    {t('info.quickInstall')}
                  </p>
                </div>

                {loadingDistros ? (
                  <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
                    <svg className="w-8 h-8 animate-spin mb-3 text-primary" viewBox="0 0 24 24">
                      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm">{t('loading')}</span>
                  </div>
                ) : enabledOnlineDistros.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
                    <LinuxLogo size={48} className="mb-3 opacity-50" />
                    <span className="text-sm">{t('empty')}</span>
                    {!catalogLoadError && (
                      <>
                        <p className="mt-2 text-sm text-center">{t('catalogRetryHint')}</p>
                        <Button variant="secondary" className="mt-3" onClick={() => setCatalogReload(value => value + 1)} disabled={isCreating}>
                          {t('common:button.retry')}
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="animate-fade-in" data-testid="quick-install-content">
                    {/* Family Filter Tabs */}
                    <div className="flex gap-2 mb-4 flex-wrap">
                      <button
                        onClick={() => setFamilyFilter(null)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                          familyFilter === null
                            ? "bg-success/20 text-success border border-success/30"
                            : "bg-surface-container text-on-surface-variant border border-outline-variant hover:text-on-surface hover:border-outline-variant"
                        }`}
                      >
                        {t('filter.all')}
                      </button>
                      {(Object.entries(DISTRO_FAMILY_NAMES) as [DistroFamily, string][]).map(([family, name]) => {
                        const count = enabledOnlineDistros.filter(d => {
                          return getDistroFamily(d) === family;
                        }).length;
                        if (count === 0) return null;
                        return (
                          <button
                            key={family}
                            onClick={() => setFamilyFilter(family)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                              familyFilter === family
                                ? "bg-success/20 text-success border border-success/30"
                                : "bg-surface-container text-on-surface-variant border border-outline-variant hover:text-on-surface hover:border-outline-variant"
                            }`}
                          >
                            {name} ({count})
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {enabledOnlineDistros
                        .filter(distro => {
                          if (familyFilter === null) return true;
                          return getDistroFamily(distro) === familyFilter;
                        })
                        .map((distro, index) => {
                      const info = getMsStoreInfo(distro);
                      const exists = distributions.some(d => d.name.toLowerCase() === distro.toLowerCase());
                      const isSelected = selectedDistro === distro;
                      const Logo = getDistroLogo(distro);

                      return (
                        <button
                          key={distro}
                          onClick={() => !exists && handleSelectQuickInstallDistro(distro)}
                          disabled={isCreating || exists}
                          className={`group relative p-4 text-left rounded-xl border transition-all duration-200 ${
                            isSelected
                              ? "border-success/50 bg-success/10 shadow-md3-1"
                              : exists
                              ? "border-outline-variant bg-surface-container/30 opacity-60 cursor-not-allowed"
                              : "border-primary/10 bg-surface-container-low hover:bg-surface-container hover:border-primary/30 hover:shadow-md3-2 hover:-translate-y-0.5"
                          }`}
                          style={{
                            animationDelay: `${index * 30}ms`,
                          }}
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`relative shrink-0 rounded-xl p-1.5 transition-all duration-200 group-hover:scale-110 group-hover:shadow-md3-2 bg-surface-container ${
                                isSelected ? "ring-2 ring-success/50" : ""
                              }`}
                            >
                              <Logo size={36} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-on-surface truncate group-hover:text-primary transition-colors">{distro}</div>
                              {info.description && (
                                <div className="text-xs text-on-surface-variant mt-0.5 line-clamp-1">{info.description}</div>
                              )}
                            </div>
                            {exists ? (
                              <span className="text-xs text-on-surface-variant bg-surface-container px-2 py-1 rounded-md">{t('common:label.installed')}</span>
                            ) : isSelected ? (
                              <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center shadow-md3-1">
                                <CheckIcon size="sm" className="text-on-success" />
                              </div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Custom Download Mode */}
            {mode === "custom" && (
              <div>
                {downloadableDistros.length === 0 && !useCustomUrl ? (
                  <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
                    <DownloadIcon size="lg" className="mb-3 opacity-50" />
                    <span className="text-sm mb-4">{t('noDownloadable')}</span>
                    <button
                      onClick={() => setUseCustomUrl(true)}
                      className="text-sm text-primary hover:underline"
                    >
                      {t('useCustomUrl')}
                    </button>
                  </div>
                ) : downloadableDistros.length === 0 && useCustomUrl ? (
                  /* Custom URL input - shown when no distros configured but custom URL selected */
                  <div className="p-4 rounded-xl border border-secondary/50 bg-secondary/10">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-secondary/20 text-secondary">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-on-surface text-sm">{t('customUrl.label')}</div>
                        <div className="text-xs text-on-surface-variant">{t('customUrl.description')}</div>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder={t('placeholder.url')}
                      disabled={isCreating}
                      className="w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg text-on-surface placeholder-on-surface-variant text-sm font-mono focus:border-secondary/50"
                    />
                  </div>
                ) : (
                  <div data-testid="download-content">
                    {/* Family Filter Tabs */}
                    <div className="flex gap-2 mb-4 flex-wrap">
                      <button
                        onClick={() => setFamilyFilter(null)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                          familyFilter === null
                            ? "bg-secondary/20 text-secondary border border-secondary/30"
                            : "bg-surface-container text-on-surface-variant border border-outline-variant hover:text-on-surface hover:border-outline-variant"
                        }`}
                      >
                        {t('filter.all')}
                      </button>
                      {(Object.entries(DISTRO_FAMILY_NAMES) as [DistroFamily, string][]).map(([family, name]) => {
                        const count = downloadableDistros.filter(d => getDistroFamily(d.id) === family).length;
                        if (count === 0) return null;
                        return (
                          <button
                            key={family}
                            onClick={() => setFamilyFilter(family)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                              familyFilter === family
                                ? "bg-secondary/20 text-secondary border border-secondary/30"
                                : "bg-surface-container text-on-surface-variant border border-outline-variant hover:text-on-surface hover:border-outline-variant"
                            }`}
                          >
                            {name} ({count})
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {downloadableDistros
                        .filter(distro => familyFilter === null || getDistroFamily(distro.id) === familyFilter)
                        .map((distro, index) => {
                        const isSelected = selectedDistro === distro.id;
                        const Logo = getDistroLogo(distro.id);

                        return (
                          <button
                            key={distro.id}
                            onClick={() => handleSelectDistroForDownload(distro.id)}
                            disabled={isCreating}
                            className={`group relative p-4 text-left rounded-xl border transition-all duration-200 ${
                              isSelected
                                ? "border-secondary/50 bg-secondary/10 shadow-md3-1"
                                : "border-primary/10 bg-surface-container-low hover:bg-surface-container hover:border-primary/30 hover:shadow-md3-2 hover:-translate-y-0.5"
                            }`}
                            style={{ animationDelay: `${index * 30}ms` }}
                          >
                            <div className="flex items-start gap-4">
                              <div
                                className={`relative shrink-0 rounded-xl p-1.5 transition-all duration-200 group-hover:scale-110 group-hover:shadow-md3-2 bg-surface-container ${
                                  isSelected ? "ring-2 ring-secondary/50" : ""
                                }`}
                              >
                                <Logo size={40} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-on-surface group-hover:text-primary transition-colors">{distro.name}</div>
                                <div className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">{distro.description}</div>
                                {distro.size && (
                                  <div className="text-xs text-on-surface-variant mt-2 font-mono flex items-center gap-1">
                                    <DownloadIcon size="sm" className="opacity-50" />
                                    {distro.size}
                                  </div>
                                )}
                              </div>
                              {isSelected && (
                                <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0 shadow-md3-1">
                                  <CheckIcon size="sm" className="text-on-secondary" />
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom URL input - always visible */}
                    <div className={`p-4 rounded-xl border transition-all duration-200 ${
                      useCustomUrl
                        ? "border-secondary/50 bg-secondary/10"
                        : "border-outline-variant bg-surface-container/50"
                    }`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`p-2 rounded-lg transition-colors ${
                          useCustomUrl ? "bg-secondary/20 text-secondary" : "bg-surface-container text-on-surface-variant"
                        }`}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-on-surface text-sm">{t('customUrl.label')}</div>
                          <div className="text-xs text-on-surface-variant">{t('customUrl.description')}</div>
                        </div>
                        {customUrl.trim() && (
                          <button
                            onClick={handleSelectCustomUrl}
                            disabled={isCreating}
                            className="px-3 py-1.5 text-xs font-medium bg-secondary state-layer text-on-secondary rounded-lg transition-colors disabled:opacity-50"
                          >
                            {t('useUrl')}
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={customUrl}
                        onChange={(e) => { setCustomUrl(e.target.value); setSelectedDistro(null); }}
                        placeholder={t('placeholder.url')}
                        disabled={isCreating}
                        className="w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg text-on-surface placeholder-on-surface-variant text-sm font-mono focus:border-secondary/50"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Community LXC Catalog Mode */}
            {mode === "community" && (
              <div>
                {!settings.distributionSources.lxcEnabled ? (
                  <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
                    <LinuxLogo size={48} className="mb-3 opacity-50" />
                    <span className="text-sm mb-2">{t('communityDisabled')}</span>
                    <span className="text-xs text-on-surface-variant">{t('communityDisabledHint')}</span>
                  </div>
                ) : (
                  <div data-testid="lxc-content">
                    <LxcCatalogBrowser
                      selectedDistro={selectedLxcDistro}
                      onSelect={handleSelectLxcDistro}
                      disabled={isCreating}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Container Mode */}
            {mode === "container" && (
              <div>
                {containerImages.length === 0 && !useCustomImage ? (
                  <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
                    <DockerLogo size={48} className="mb-3 opacity-50" />
                    <span className="text-sm mb-4">{t('noContainerImages')}</span>
                    <button
                      onClick={() => setUseCustomImage(true)}
                      className="text-sm text-primary hover:underline"
                    >
                      {t('useCustomImage')}
                    </button>
                  </div>
                ) : (
                  <div data-testid="container-content">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {containerImages.map((image, index) => {
                        const isSelected = selectedContainer?.id === image.id && !useCustomImage;
                        const Logo = getDistroLogo(image.id);

                        return (
                          <button
                            key={image.id}
                            onClick={() => handleSelectContainer(image)}
                            disabled={isCreating}
                            className={`group relative p-4 text-left rounded-xl border transition-all duration-200 ${
                              isSelected
                                ? "border-primary/50 bg-primary/10 shadow-md3-1"
                                : "border-primary/10 bg-surface-container-low hover:bg-surface-container hover:border-primary/30 hover:shadow-md3-2 hover:-translate-y-0.5"
                            }`}
                            style={{ animationDelay: `${index * 30}ms` }}
                          >
                            <div className="flex items-center gap-4">
                              <div
                                className={`relative shrink-0 rounded-xl p-1 transition-transform duration-200 group-hover:scale-110 bg-surface-container ${
                                  isSelected ? "ring-2 ring-primary/50" : ""
                                }`}
                              >
                                <Logo size={36} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-on-surface group-hover:text-primary truncate transition-colors duration-200">{image.name}</div>
                                <div className="text-xs text-on-surface-variant mt-0.5 line-clamp-1">{image.description}</div>
                              </div>
                              {isSelected && (
                                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                                  <CheckIcon size="sm" className="text-on-primary" />
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom image input - always visible */}
                    <div className={`p-4 rounded-xl border transition-all duration-200 ${
                      useCustomImage
                        ? "border-primary/50 bg-primary/10"
                        : "border-outline-variant bg-surface-container/50"
                    }`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`p-2 rounded-lg transition-colors ${
                          useCustomImage ? "bg-primary/20 text-primary" : "bg-surface-container text-on-surface-variant"
                        }`}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-on-surface text-sm">{t('customImage.label')}</div>
                          <div className="text-xs text-on-surface-variant">{t('customImage.description')}</div>
                        </div>
                        {customImage.trim() && (
                          <button
                            onClick={handleSelectCustomImage}
                            disabled={isCreating}
                            className="px-3 py-1.5 text-xs font-medium bg-primary state-layer text-on-primary rounded-lg transition-colors disabled:opacity-50"
                          >
                            {t('useImage')}
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={customImage}
                        onChange={(e) => { setCustomImage(e.target.value); setSelectedContainer(null); }}
                        placeholder={t('placeholder.image')}
                        disabled={isCreating}
                        className="w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg text-on-surface placeholder-on-surface-variant text-sm font-mono focus:border-primary/50"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Trademark disclaimer */}
            <div className="mt-6 pt-4 border-t border-outline-variant">
              <p className="text-xs text-on-surface-variant text-center leading-relaxed whitespace-pre-line">
                {t('trademarkDisclaimer')}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-outline-variant bg-surface-container/30">
            <div className="flex items-center justify-between">
              {/* Selection summary - only for quick mode */}
              <div className="text-sm text-on-surface-variant font-mono truncate max-w-md">
                {mode === "quick" && selectedDistro && (
                  <span>{t('installingAs', { name: selectedDistro })}</span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3">
                <Button
                  data-testid="new-distro-cancel-button"
                  variant="secondary"
                  onClick={handleClose}
                  disabled={isCreating}
                >
                  {t('common:button.cancel')}
                </Button>
                {/* Install button only for quick mode - other modes use config dialog */}
                {mode === "quick" && (
                  <Button
                    data-testid="new-distro-install-button"
                    variant="primary"
                    colorScheme="success"
                    onClick={handleQuickInstall}
                    disabled={!canQuickInstall}
                    loading={isCreating}
                    icon={!isCreating ? <DownloadIcon size="sm" /> : undefined}
                  >
                    {isCreating ? `${t('install')}...` : t('install')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Install Configuration Dialog */}
      {pendingInstallItem && (
        <InstallConfigDialog
          isOpen={showInstallConfig}
          onClose={() => {
            setShowInstallConfig(false);
            setPendingInstallItem(null);
          }}
          onInstall={handleInstallFromConfig}
          mode={mode === "custom" ? "download" : mode as "community" | "container"}
          selectedItem={pendingInstallItem}
        />
      )}
    </Portal>
  );
}
