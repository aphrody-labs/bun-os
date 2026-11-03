/**
 * Set WSL Version Dialog
 *
 * Dialog for changing a distribution's WSL version (1 or 2).
 * Shows current version, target version options, and warnings about conversion time.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { wslService } from "../services/wslService";
import { useDistroStore } from "../store/distroStore";
import { useNotificationStore } from "../store/notificationStore";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "./ui/Modal";
import { Button } from "./ui/Button";
import { WarningIcon } from "./icons";
import type { Distribution } from "../types/distribution";

interface SetVersionDialogProps {
  isOpen: boolean;
  distro: Distribution;
  onClose: () => void;
}

export function SetVersionDialog({ isOpen, distro, onClose }: SetVersionDialogProps) {
  const { t } = useTranslation("dialogs");
  const [selectedVersion, setSelectedVersion] = useState<1 | 2>(
    distro.version === 1 ? 2 : 1
  );
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fetchDistros } = useDistroStore();
  const { addNotification } = useNotificationStore();

  const currentVersion = distro.version as 1 | 2;
  const targetVersion = selectedVersion;

  const handleConvert = async () => {
    if (targetVersion === currentVersion) {
      return;
    }

    setError(null);
    setIsConverting(true);

    try {
      await wslService.setDistroVersion(distro.name, targetVersion);
      await fetchDistros();
      addNotification({
        type: "success",
        title: t('setVersion.successTitle'),
        message: t('setVersion.successMessage', { name: distro.name, version: targetVersion }),
      });
      handleClose();
    } catch (err) {
      const errorMessage = typeof err === "string" ? err : err instanceof Error ? err.message : t('setVersion.errorFailed');
      setError(errorMessage);
    } finally {
      setIsConverting(false);
    }
  };

  const handleClose = () => {
    if (!isConverting) {
      setError(null);
      setSelectedVersion(distro.version === 1 ? 2 : 1);
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} closeOnBackdrop={!isConverting} size="sm">
      <ModalHeader
        title={t('setVersion.title')}
        subtitle={t('setVersion.subtitle', { name: distro.name })}
        onClose={handleClose}
        showCloseButton={!isConverting}
      />

      <ModalBody>
        {error && (
          <div className="mb-4 p-3 bg-error/20 border border-error/40 rounded-lg text-error text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Version Options */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-on-surface-variant mb-2">
              {t('setVersion.selectVersion')}
            </label>

            {/* WSL 1 Option */}
            <button
              onClick={() => setSelectedVersion(1)}
              disabled={isConverting || currentVersion === 1}
              className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                selectedVersion === 1
                  ? "border-primary bg-primary/10"
                  : currentVersion === 1
                  ? "border-outline-variant bg-surface-container opacity-60 cursor-not-allowed"
                  : "border-outline-variant hover:border-outline-variant bg-surface-container"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-on-surface">WSL 1</div>
                  <div className="text-sm text-on-surface-variant">
                    {t('setVersion.wsl1Description')}
                  </div>
                </div>
                {currentVersion === 1 && (
                  <span className="text-xs px-2 py-1 rounded bg-primary text-on-primary font-medium">
                    {t('setVersion.current')}
                  </span>
                )}
              </div>
            </button>

            {/* WSL 2 Option */}
            <button
              onClick={() => setSelectedVersion(2)}
              disabled={isConverting || currentVersion === 2}
              className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                selectedVersion === 2
                  ? "border-primary bg-primary/10"
                  : currentVersion === 2
                  ? "border-outline-variant bg-surface-container opacity-60 cursor-not-allowed"
                  : "border-outline-variant hover:border-outline-variant bg-surface-container"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-on-surface">WSL 2</div>
                  <div className="text-sm text-on-surface-variant">
                    {t('setVersion.wsl2Description')}
                  </div>
                </div>
                {currentVersion === 2 && (
                  <span className="text-xs px-2 py-1 rounded bg-primary text-on-primary font-medium">
                    {t('setVersion.current')}
                  </span>
                )}
              </div>
            </button>
          </div>

          {/* Conversion Warning */}
          <div className="p-3 bg-warning/15 border border-warning/30 rounded-lg flex items-start gap-3">
            <WarningIcon size="sm" className="text-warning mt-0.5 shrink-0" />
            <div className="text-warning/80 text-sm space-y-1">
              <p className="font-medium">{t('setVersion.warningTime')}</p>
              <p>
                {currentVersion === 1 && targetVersion === 2
                  ? t('setVersion.convertToWsl2')
                  : t('setVersion.convertToWsl1')}
              </p>
            </div>
          </div>
        </div>

        {isConverting && (
          <div className="mt-4 p-3 bg-surface-container border border-outline-variant rounded-lg">
            <div className="flex items-center gap-3 text-on-surface-variant text-sm">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>{t('setVersion.progress', { version: targetVersion })}</span>
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose} disabled={isConverting}>
          {t('common:button.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleConvert}
          disabled={isConverting || targetVersion === currentVersion}
          loading={isConverting}
        >
          {t('setVersion.convert', { version: targetVersion })}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
