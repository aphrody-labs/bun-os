import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon, CheckIcon, WarningIcon, InfoIcon } from "./icons";
import type { NotificationType } from "../store/notificationStore";

const styles = {
  success: {
    container: "bg-success/5 border-success/30",
    icon: "bg-success/10 border-success/30",
    text: "text-success",
    button: "hover:text-success hover:bg-success/10 hover:border-success/30",
  },
  info: {
    container: "bg-primary/5 border-primary/30",
    icon: "bg-primary/10 border-primary/30",
    text: "text-primary",
    button: "hover:text-primary hover:bg-primary/10 hover:border-primary/30",
  },
  warning: {
    container: "bg-warning/5 border-warning/30",
    icon: "bg-warning/10 border-warning/30",
    text: "text-warning",
    button: "hover:text-warning hover:bg-warning/10 hover:border-warning/30",
  },
  error: {
    container: "bg-error/5 border-error/30",
    icon: "bg-error/10 border-error/30",
    text: "text-error",
    button: "hover:text-error hover:bg-error/10 hover:border-error/30",
  },
};

const icons = {
  success: CheckIcon,
  info: InfoIcon,
  warning: WarningIcon,
  error: WarningIcon,
};

interface NotificationBannerProps {
  type: NotificationType;
  title: string;
  message: string;
  onDismiss?: () => void;
  autoDismiss?: number; // milliseconds, 0 = no auto-dismiss
  children?: React.ReactNode;
  testId?: string;
}

export function NotificationBanner({
  type,
  title,
  message,
  onDismiss,
  autoDismiss = 0,
  children,
  testId = "notification-banner"
}: NotificationBannerProps) {
  const { t } = useTranslation("common");
  const [isVisible, setIsVisible] = useState(false); // Start hidden for enter animation
  const [isClosing, setIsClosing] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  const closingTimerRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss); // Store onDismiss in ref to avoid effect re-runs
  const style = styles[type];
  const Icon = icons[type];

  // Keep the ref updated with the latest onDismiss
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // Derive child testIds from the main testId (e.g., "error-banner" -> "error-message", "error-dismiss-button")
  const testIdPrefix = testId.replace(/-banner$/, "");
  const messageTestId = `${testIdPrefix}-message`;
  const dismissTestId = `${testIdPrefix}-dismiss-button`;

  // Trigger enter animation after mount
  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      setIsVisible(true);
    });
    return () => cancelAnimationFrame(timer);
  }, []);

  const handleDismiss = () => {
    if (closingTimerRef.current !== null) return; // Prevent manual/automatic double-trigger
    setIsClosing(true);
    // Wait for animation to complete before calling onDismiss
    const dismiss = onDismissRef.current;
    closingTimerRef.current = window.setTimeout(() => {
      dismiss?.();
    }, 300);
  };

  useEffect(() => () => {
    if (closingTimerRef.current !== null) clearTimeout(closingTimerRef.current);
  }, []);

  // Auto-dismiss after specified time (with animation)
  // Only depends on autoDismiss - onDismiss is accessed via ref
  useEffect(() => {
    if (autoDismiss && autoDismiss > 0 && onDismissRef.current) {
      dismissTimerRef.current = window.setTimeout(() => {
        handleDismiss();
      }, autoDismiss);
    }
    return () => {
      if (dismissTimerRef.current !== null) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [autoDismiss]);

  const isExpanded = isVisible && !isClosing;

  // Accessibility: Use assertive for errors/warnings, polite for info/success
  const ariaLive = type === "error" || type === "warning" ? "assertive" : "polite";
  const role = type === "error" || type === "warning" ? "alert" : "status";

  return (
    <div
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      className="grid transition-[grid-template-rows,margin] duration-300 ease-emphasized-decelerate"
      style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr", marginTop: isExpanded ? 24 : 0, marginBottom: isExpanded ? 20 : 0 }}
    >
      <div className="overflow-hidden">
        <div
          data-testid={testId}
          className={`p-4 border rounded-xl shadow-md3-1 transition-opacity duration-200 ${
            isExpanded ? "opacity-100" : "opacity-0"
          } ${style.container}`}
        >

        <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 ${style.icon}`}>
          <Icon size="md" className={style.text} />
        </div>
        <div className="flex-1 min-w-0">
          <p data-testid={`${testIdPrefix}-title`} className={`font-semibold text-sm uppercase tracking-wider font-mono ${style.text}`}>
            {title}
          </p>
          <p data-testid={messageTestId} className="text-sm mt-2 text-on-surface-variant break-words whitespace-pre-wrap leading-relaxed">
            {message}
          </p>
          {children && <div className="mt-4">{children}</div>}
        </div>
        {onDismiss && (
          <button
            onClick={handleDismiss}
            data-testid={dismissTestId}
            aria-label={t('button.dismiss')}
            className={`p-2 text-on-surface-variant rounded-lg border border-transparent transition-all flex-shrink-0 ${style.button}`}
            title={t('button.dismiss')}
          >
            <CloseIcon size="sm" />
          </button>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}
