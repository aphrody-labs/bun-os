import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Portal } from "./ui/Portal";
import { CloseIcon, LockIcon } from "./icons";

interface PasswordPromptDialogProps {
  isOpen: boolean;
  actionName: string;
  distroName: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPromptDialog({
  isOpen,
  actionName,
  distroName,
  onSubmit,
  onCancel,
}: PasswordPromptDialogProps) {
  const { t } = useTranslation("dialogs");
  const [password, setPassword] = useState("");

  const handleCancel = useCallback(() => {
    setPassword("");
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
      setPassword("");
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 bg-scrim/32 flex items-center justify-center z-[100] p-4" data-testid="password-prompt-overlay">
        <div className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-md3-3 max-w-md w-full overflow-hidden animate-fade-slide-in" data-testid="password-prompt-dialog">

          <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <LockIcon size="md" className="text-primary" />
              </div>
              <h3 className="font-semibold text-on-surface" data-testid="password-prompt-title">{t('password.title')}</h3>
            </div>
            <button
              onClick={handleCancel}
              className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-lg transition-all"
              data-testid="password-prompt-close"
            >
              <CloseIcon size="md" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5" data-testid="password-prompt-form">
            <p className="text-sm text-on-surface-variant mb-4">
              {t('password.descriptionPrefix')} <span className="font-medium text-on-surface" data-testid="password-prompt-action-name">"{actionName}"</span> {t('password.descriptionSuffix')} <span className="font-medium text-on-surface" data-testid="password-prompt-distro-name">{distroName}</span>.
            </p>
            <p className="text-xs text-on-surface-variant mb-4">
              {t('password.instruction')}
            </p>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('password.placeholder')}
              autoFocus
              data-testid="password-prompt-input"
              className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-lg text-on-surface placeholder-on-surface-variant focus:border-primary transition-colors"
            />

            <p className="text-xs text-on-surface-variant mt-3" data-testid="password-prompt-security-note">
              {t('password.securityNote')}
            </p>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={handleCancel}
                data-testid="password-prompt-cancel"
                className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
              >
                {t('common:button.cancel')}
              </button>
              <button
                type="submit"
                disabled={!password.trim()}
                data-testid="password-prompt-submit"
                className="px-4 py-2 text-sm font-medium bg-primary state-layer text-on-primary rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('password.submit')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
