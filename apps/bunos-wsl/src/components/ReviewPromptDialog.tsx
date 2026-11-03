/**
 * Review Prompt Dialog
 *
 * Shown after successful distro installation to encourage users
 * to leave a review on Microsoft Store.
 */

import { useTranslation } from "react-i18next";
import { Portal } from "./ui/Portal";
import { AppMark } from "./AppMark";

interface ReviewPromptDialogProps {
  isOpen: boolean;
  onReview: () => void;
  onMaybeLater: () => void;
  onNoThanks: () => void;
}

export function ReviewPromptDialog({
  isOpen,
  onReview,
  onMaybeLater,
  onNoThanks,
}: ReviewPromptDialogProps) {
  const { t } = useTranslation("dialogs");

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-scrim/40 backdrop-blur-xs" />

        {/* Dialog */}
        <div
          role="dialog"
          aria-modal="true"
          data-testid="review-prompt-dialog"
          className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-2xl shadow-shadow/50 max-w-md w-full mx-4 p-6"
        >
          <div className="flex items-start gap-4 mb-5">
            <div className="shrink-0">
              <AppMark size={48} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">
                {t('review.title')}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                {t('review.description')}
              </p>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onNoThanks}
              data-testid="review-no-thanks-button"
              className="px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {t('review.noThanks')}
            </button>
            <button
              onClick={onMaybeLater}
              data-testid="review-maybe-later-button"
              className="px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors"
            >
              {t('review.maybeLater')}
            </button>
            <button
              onClick={onReview}
              data-testid="review-leave-review-button"
              className="px-4 py-2 text-sm font-medium text-on-primary bg-primary hover:opacity-90 rounded-lg transition-colors"
            >
              {t('review.leaveReview')}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
