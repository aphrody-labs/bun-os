/**
 * Close Action Dialog
 *
 * A dialog shown when the user tries to close the application and their
 * preference is set to "ask". Allows choosing between minimizing to tray
 * or quitting the application, with an option to remember the choice.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Portal } from "./ui/Portal";
import { CloseIcon, MinimizeIcon } from "./icons";

interface CloseActionDialogProps {
  isOpen: boolean;
  onMinimize: () => void;
  onQuit: () => void;
  onCancel: () => void;
  onRememberChoice: (action: "minimize" | "quit") => void;
}

export function CloseActionDialog({
  isOpen,
  onMinimize,
  onQuit,
  onCancel,
  onRememberChoice,
}: CloseActionDialogProps) {
  const { t } = useTranslation("dialogs");
  const [rememberChoice, setRememberChoice] = useState(false);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setRememberChoice(false);
    }
  }, [isOpen]);

  const handleMinimize = useCallback(() => {
    if (rememberChoice) {
      onRememberChoice("minimize");
    }
    onMinimize();
  }, [rememberChoice, onMinimize, onRememberChoice]);

  const handleQuit = useCallback(() => {
    if (rememberChoice) {
      onRememberChoice("quit");
    }
    onQuit();
  }, [rememberChoice, onQuit, onRememberChoice]);

  // Handle Escape key to cancel dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-scrim/32"
          onClick={onCancel}
        />

        {/* Dialog */}
        <div
          role="dialog"
          aria-modal="true"
          data-testid="close-action-dialog"
          className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-md3-3 max-w-md w-full mx-4 p-6"
        >
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-primary/20 text-primary">
              <CloseIcon size="md" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">
                {t('closeAction.title')}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                {t('closeAction.description')}
              </p>
            </div>
          </div>

          {/* Remember choice checkbox - above buttons */}
          <div className="mb-4 p-3 bg-surface-container border border-outline-variant rounded-lg">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
                className="w-4 h-4 rounded border-outline-variant bg-surface-container text-primary focus:ring-primary"
              />
              <span className="text-sm text-on-surface-variant">
                {t('closeAction.rememberChoice')}
              </span>
            </label>
            {rememberChoice && (
              <p className="text-xs text-on-surface-variant mt-2 ml-7">
                {t('closeAction.changeInSettings')}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={handleMinimize}
              data-testid="close-dialog-minimize-button"
              className="px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors flex items-center gap-2"
            >
              <MinimizeIcon size="sm" />
              {t('closeAction.minimizeToTray')}
            </button>
            <button
              onClick={handleQuit}
              data-testid="close-dialog-quit-button"
              className="px-4 py-2 text-sm font-medium text-on-error bg-error state-layer rounded-lg transition-colors flex items-center gap-2"
            >
              <CloseIcon size="sm" />
              {t('closeAction.quit')}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
