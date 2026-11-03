/**
 * Telemetry Opt-In Dialog
 *
 * Shown on first launch to ask the user if they want to share
 * anonymous usage data to help improve Bun OS WSL.
 */

import { useTranslation } from "react-i18next";
import { Portal } from "./ui/Portal";
import { ChartBarIcon, ShieldCheckIcon } from "./icons";

interface TelemetryOptInDialogProps {
  isOpen: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function TelemetryOptInDialog({
  isOpen,
  onAccept,
  onDecline,
}: TelemetryOptInDialogProps) {
  const { t } = useTranslation("dialogs");

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-scrim/32" />

        {/* Dialog */}
        <div
          role="dialog"
          aria-modal="true"
          data-testid="telemetry-opt-in-dialog"
          className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-md3-3 max-w-lg w-full mx-4 p-6"
        >
          <div className="flex items-start gap-4 mb-5">
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-primary/20 text-primary">
              <ChartBarIcon size="lg" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">
                {t('telemetry.title')}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                {t('telemetry.subtitle')}
              </p>
            </div>
          </div>

          {/* What we collect */}
          <div className="mb-5 p-4 bg-surface-container border border-outline-variant rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheckIcon size="sm" className="text-success" />
              <span className="text-sm font-medium text-on-surface">
                {t('telemetry.privacyTitle')}
              </span>
            </div>
            <ul className="text-sm text-on-surface-variant space-y-1.5 ml-6">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>{t('telemetry.dataPoint1')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>{t('telemetry.dataPoint2')}</span>
              </li>
            </ul>
            <div className="mt-3 pt-3 border-t border-outline-variant">
              <p className="text-xs text-on-surface-variant">
                {t('telemetry.privacyNote')}{" "}
                <a
                  href="https://aptabase.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Aptabase
                </a>
                {t('telemetry.privacyNoteSuffix')}
              </p>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onDecline}
              data-testid="telemetry-decline-button"
              className="px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors"
            >
              {t('telemetry.decline')}
            </button>
            <button
              onClick={onAccept}
              data-testid="telemetry-accept-button"
              className="px-4 py-2 text-sm font-medium text-on-primary bg-primary state-layer rounded-lg transition-colors"
            >
              {t('telemetry.accept')}
            </button>
          </div>

          <p className="text-xs text-on-surface-variant text-center mt-4">
            {t('telemetry.changeAnytime')}
          </p>
        </div>
      </div>
    </Portal>
  );
}
