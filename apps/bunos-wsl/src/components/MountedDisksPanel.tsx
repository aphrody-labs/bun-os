import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDiskMountEntries, useMountStore } from "../store/mountStore";
import { TrashIcon } from "./icons";
import { Icon } from "@aphrody/m3-primitives";

interface MountedDisksPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onMountNew: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function MountedDisksPanel({ isOpen, onClose, onMountNew, anchorRef }: MountedDisksPanelProps) {
  const { t } = useTranslation("dialogs");
  const panelRef = useRef<HTMLDivElement>(null);
  const [unmountingPath, setUnmountingPath] = useState<string | null>(null);
  const { mountedDisks, trackedMounts, isLoading, isUnmounting, loadMountedDisks, unmountDisk, unmountAll, error, clearError } = useMountStore();

  // Load mounted disks when panel opens
  useEffect(() => {
    if (isOpen) {
      loadMountedDisks();
    }
  }, [isOpen, loadMountedDisks]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  const diskEntries = getDiskMountEntries(mountedDisks, trackedMounts);

  const handleUnmountAll = async () => {
    try {
      await unmountAll();
    } catch {
      // Error is handled in store
    }
  };

  const handleUnmountDisk = async (mountPoint: string, diskPath: string) => {
    setUnmountingPath(mountPoint);
    try {
      // Use the original diskPath for unmounting
      await unmountDisk(diskPath);
    } catch {
      // Error is handled in store
    } finally {
      setUnmountingPath(null);
    }
  };

  return (
    <div
      ref={panelRef}
      data-testid="mounted-disks-panel"
      className="absolute left-0 bottom-full mb-2 w-72 bg-surface-container-low border border-outline-variant rounded-xl shadow-md3-3 z-50"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-outline-variant">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-on-surface-variant uppercase tracking-wide font-mono" data-testid="mounted-disks-title">
            {t('mountedDisks.title')}
          </span>
          {diskEntries.length > 0 && (
            <button
              onClick={handleUnmountAll}
              disabled={isUnmounting}
              data-testid="unmount-all-button"
              className="text-xs px-2 py-0.5 text-error hover:bg-error/15 rounded transition-colors disabled:opacity-50"
            >
              {isUnmounting ? "..." : t('mountedDisks.unmountAll')}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-error/10 border-b border-error/30" data-testid="mounted-disks-error">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-error flex-1">{error}</p>
            <button
              onClick={clearError}
              data-testid="mounted-disks-clear-error"
              className="text-error state-layer"
              aria-label={t("common:button.close")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-h-48 overflow-y-auto" data-testid="mounted-disks-list">
        {isLoading ? (
          <div className="px-3 py-6 text-center" data-testid="mounted-disks-loading">
            <div className="w-4 h-4 border-2 border-outline-variant border-t-primary rounded-full animate-spin mx-auto" />
          </div>
        ) : diskEntries.length === 0 ? (
          <div className="px-3 py-6 text-center" data-testid="mounted-disks-empty">
            <div className="text-outline text-2xl mb-1">○</div>
            <p className="text-xs text-on-surface-variant">{t('mountedDisks.noDisks')}</p>
            <p className="text-xs text-outline mt-1">
              {t('mountedDisks.noDisksHint')}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {diskEntries.map((disk, index) => {
              const tracked = disk.diskPath;
              const isThisUnmounting = unmountingPath === disk.mountPoint;
              return (
                <div
                  key={`${disk.path}:${disk.mountPoint}:${index}`}
                  data-testid={`mounted-disk-${index}`}
                  className="px-3 py-2 hover:bg-surface-container border-b border-outline-variant last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm text-on-surface min-w-0">
                      <span className="text-on-surface-variant flex-shrink-0">{disk.isVhd ? "◉" : "●"}</span>
                      <code className="font-mono text-primary text-xs truncate" data-testid={`mounted-disk-${index}-path`}>
                        {disk.mountPoint}
                      </code>
                    </div>
                    {tracked && (
                      <button
                        onClick={() => handleUnmountDisk(disk.mountPoint, tracked)}
                        disabled={isUnmounting}
                        data-testid={`unmount-disk-${index}`}
                        className="p-1 text-on-surface-variant hover:text-error hover:bg-error/10 rounded transition-colors disabled:opacity-50"
                        title={t('mountedDisks.unmountDisk')}
                      >
                        {isThisUnmounting ? (
                          <div className="w-3 h-3 border border-on-surface-variant border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <TrashIcon size="sm" />
                        )}
                      </button>
                    )}
                  </div>
                  {disk.filesystem && (
                    <div className="text-xs text-on-surface-variant ml-5 mt-0.5" data-testid={`mounted-disk-${index}-fs`}>
                      {disk.filesystem}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-outline-variant p-2">
        <button
          onClick={() => {
            onClose();
            onMountNew();
          }}
          data-testid="mount-new-disk-button"
          className="w-full px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors flex items-center justify-center gap-1.5"
        >
          <span>+</span>
          <span>{t('mountedDisks.mountDisk')}</span>
        </button>
      </div>
    </div>
  );
}
