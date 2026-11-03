/**
 * Stop And Action Dialog
 *
 * A confirmation dialog shown when an action requires stopping a running distribution.
 * Provides a seamless "Stop & Continue" experience instead of requiring manual stop.
 *
 * For actions that require full WSL shutdown (like resize disk), set requiresShutdown=true
 * to show a more prominent warning with red styling.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Portal } from "./ui/Portal";
import { PauseIcon, WarningIcon, PowerIcon } from "./icons";

interface StopAndActionDialogProps {
  isOpen: boolean;
  distroName: string;
  actionName: string;
  /** If true, shows shutdown variant with red styling and different messaging */
  requiresShutdown?: boolean;
  onStopAndContinue: () => Promise<void>;
  onCancel: () => void;
}

export function StopAndActionDialog({
  isOpen,
  distroName,
  actionName,
  requiresShutdown = false,
  onStopAndContinue,
  onCancel,
}: StopAndActionDialogProps) {
  const { t } = useTranslation("dialogs");
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setIsStopping(false);
      setError(null);
    }
  }, [isOpen]);

  const handleStopAndContinue = async () => {
    setIsStopping(true);
    setError(null);

    try {
      await onStopAndContinue();
    } catch (err) {
      const errorMessage =
        typeof err === "string"
          ? err
          : err instanceof Error
          ? err.message
          : t('stopAction.errorFailed');
      setError(errorMessage);
      setIsStopping(false);
    }
  };

  const handleCancel = useCallback(() => {
    if (!isStopping) {
      onCancel();
    }
  }, [isStopping, onCancel]);

  // Handle Escape key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isStopping) {
        handleCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isStopping, handleCancel]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-scrim/32"
          onClick={handleCancel}
        />

        {/* Dialog */}
        <div
          role="dialog"
          aria-modal="true"
          data-testid="stop-and-action-dialog"
          className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-md3-3 max-w-md w-full mx-4 p-6"
        >
          <div className="flex items-start gap-4 mb-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              requiresShutdown
                ? "bg-error/20 text-error"
                : "bg-warning/20 text-warning"
            }`}>
              {requiresShutdown ? <PowerIcon size="md" /> : <PauseIcon size="md" />}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">
                {requiresShutdown ? t('stopAction.titleShutdown') : t('stopAction.titleStop')}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                <span className="font-medium text-on-surface">{actionName}</span>{" "}
                {t('stopAction.requires')}{" "}
                {requiresShutdown ? (
                  <>
                    <span className="font-medium text-error">{t('stopAction.allDistros')}</span>{" "}
                    {t('stopAction.shutdownReason')}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-warning">{distroName}</span>{" "}
                    {t('stopAction.stopReason')}
                  </>
                )}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-error/20 border border-error/40 rounded-lg flex items-start gap-2">
              <WarningIcon size="sm" className="text-error mt-0.5 shrink-0" />
              <span className="text-error text-sm">{error}</span>
            </div>
          )}

          {isStopping && (
            <div
              data-testid="stop-dialog-loading"
              className="mb-4 p-3 bg-surface-container border border-outline-variant rounded-lg"
            >
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
                <span>{requiresShutdown ? t('stopAction.shuttingDown') : t('stopAction.stopping', { name: distroName })}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={handleCancel}
              disabled={isStopping}
              data-testid="stop-dialog-cancel-button"
              className="px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common:button.cancel')}
            </button>
            <button
              onClick={handleStopAndContinue}
              disabled={isStopping}
              data-testid="stop-and-continue-button"
              className={`px-4 py-2 text-sm font-medium state-layer rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
                requiresShutdown ? "bg-error text-on-error" : "bg-warning text-on-warning"
              }`}
            >
              {isStopping ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                  {requiresShutdown ? t('stopAction.shuttingDownShort') : t('stopAction.stoppingShort')}
                </>
              ) : (
                <>
                  {requiresShutdown ? <PowerIcon size="sm" /> : <PauseIcon size="sm" />}
                  {requiresShutdown ? t('stopAction.shutdownAndContinue') : t('stopAction.stopAndContinue')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
