import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { WarningIcon } from "./icons";
import { Portal } from "./ui/Portal";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation("dialogs");
  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  // Handle Escape key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleCancel]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-scrim/40 backdrop-blur-xs" onClick={handleCancel} />

        {/* Dialog */}
        <div
          role="dialog"
          data-testid="confirm-dialog"
          className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-2xl shadow-shadow/50 max-w-md w-full mx-4 p-6"
        >
          <div className="flex items-start gap-4 mb-4">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                danger ? "bg-error/20 text-error" : "bg-warning/20 text-warning"
              }`}
            >
              <WarningIcon size="md" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">{title}</h3>
              <p className="text-sm text-on-surface-variant mt-1 whitespace-pre-line">{message}</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={handleCancel}
              data-testid="dialog-cancel-button"
              className="px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors"
            >
              {t('common:button.cancel')}
            </button>
            <button
              onClick={onConfirm}
              data-testid="dialog-confirm-button"
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                danger
                  ? "bg-error hover:opacity-90 text-on-error"
                  : "bg-warning hover:opacity-90 text-on-warning"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

