import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Distribution } from "../types/distribution";
import type { CustomAction } from "../types/actions";
import { actionSymbol } from "../types/actions";
import { Icon } from "@aphrody/m3-primitives";
import {
  FolderIcon,
  CodeIcon,
  RefreshIcon,
  UploadIcon,
  CopyIcon,
  StarIcon,
  SettingsIcon,
  ChevronRightIcon,
  UserIcon,
  ServerIcon,
  SparklesIcon,
  PauseIcon,
  PowerIcon,
  InfoIcon,
  CompressIcon,
} from "./icons";

export interface QuickActionsPopupData {
  distro: Distribution;
  actions: CustomAction[];
}

interface QuickActionsPopupProps extends QuickActionsPopupData {
  onAction: (actionId: string) => void;
}

/** Renders quick-action content without owning Tauri window/event lifecycle. */
export function QuickActionsPopup({ distro, actions, onAction }: QuickActionsPopupProps) {
  const { t } = useTranslation(["actions", "common"]);
  const [showManageSubmenu, setShowManageSubmenu] = useState(false);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const menuItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    );
    if (menuItems.length === 0) {
      return;
    }

    event.preventDefault();
    const focusedIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = menuItems.length - 1;
    } else if (event.key === "ArrowUp") {
      nextIndex = focusedIndex <= 0 ? menuItems.length - 1 : focusedIndex - 1;
    } else {
      nextIndex = focusedIndex < 0 || focusedIndex === menuItems.length - 1 ? 0 : focusedIndex + 1;
    }
    menuItems[nextIndex].focus();
  };

  // Built-in actions
  const builtInActions = [
    { id: "info", label: t("quickActions.info"), icon: <InfoIcon size="sm" /> },
    { id: "explorer", label: t("quickActions.explorer"), icon: <FolderIcon size="sm" /> },
    { id: "ide", label: t("quickActions.ide"), icon: <CodeIcon size="sm" /> },
    { id: "restart", label: t("quickActions.restart"), icon: <RefreshIcon size="sm" /> },
    { id: "export", label: t("quickActions.export"), icon: <UploadIcon size="sm" />, requiresStopped: true },
    { id: "clone", label: t("quickActions.clone"), icon: <CopyIcon size="sm" />, requiresStopped: true },
    {
      id: "default",
      label: distro.isDefault ? t("quickActions.alreadyDefault") : t("quickActions.setDefault"),
      icon: <StarIcon size="sm" filled={distro.isDefault} />,
      disabled: distro.isDefault,
      highlight: distro.isDefault,
    },
  ];

  return (
    <div
      aria-label={`${t("quickActions.title")}: ${distro.name}`}
      className="bg-transparent min-w-[220px] h-screen"
      data-testid="quick-actions-menu"
      onKeyDown={handleMenuKeyDown}
      role="menu"
    >
      <div className="bg-surface-container-low rounded-xl shadow-md3-2 py-1 h-full overflow-y-auto">

      {/* Built-in actions */}
      {builtInActions.map((action) => (
        <button
          key={action.id}
          onClick={() => onAction(action.id)}
          disabled={action.disabled}
          data-testid={`quick-action-${action.id}`}
          role="menuitem"
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-all ${
            action.disabled
              ? "text-outline cursor-not-allowed"
              : action.highlight
              ? "text-primary hover:bg-primary/8"
              : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
          }`}
        >
          <span className={action.highlight ? "text-primary" : "text-on-surface-variant"}>
            {action.icon}
          </span>
          {action.label}
          {action.requiresStopped && distro.state === "Running" && (
            <span
              className="ml-auto text-warning"
              data-testid="requires-stop-indicator"
              title={t("customActions.requiresStop")}
            >
              <PauseIcon size="sm" />
            </span>
          )}
        </button>
      ))}

      {/* Manage Submenu */}
      <div className="border-t border-outline-variant my-1" role="separator" />
      <div className="relative">
        <button
          aria-expanded={showManageSubmenu}
          aria-haspopup="menu"
          onClick={() => setShowManageSubmenu((isVisible) => !isVisible)}
          data-testid="quick-action-manage"
          role="menuitem"
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
        >
          <span className="flex items-center gap-3">
            <span className="text-on-surface-variant">
              <SettingsIcon size="sm" />
            </span>
            {t("manage.title")}
          </span>
          <ChevronRightIcon
            size="sm"
            className={`text-on-surface-variant transition-transform ${
              showManageSubmenu ? "rotate-90" : ""
            }`}
          />
        </button>

        {showManageSubmenu && (
          <div
            aria-label={t("manage.title")}
            className="bg-surface/50 border-y border-outline-variant"
            role="menu"
          >
            {distro.version === 2 && (
              <button
                onClick={() => onAction("manage:move")}
                data-testid="manage-action-move"
                role="menuitem"
                className="w-full flex items-center gap-3 px-6 py-2 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
              >
                <span className="text-on-surface-variant"><FolderIcon size="sm" /></span>
                {t("manage.move")}
                {distro.state === "Running" && (
                  <span className="ml-auto text-error" data-testid="requires-shutdown-indicator" title={t("customActions.requiresShutdown")}>
                    <PowerIcon size="sm" />
                  </span>
                )}
              </button>
            )}
            {distro.version === 2 && (
              <button
                onClick={() => onAction("manage:resize")}
                data-testid="manage-action-resize"
                role="menuitem"
                className="w-full flex items-center gap-3 px-6 py-2 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
              >
                <span className="text-on-surface-variant"><ServerIcon size="sm" /></span>
                {t("manage.resize")}
                {distro.state === "Running" && (
                  <span className="ml-auto text-error" data-testid="requires-shutdown-indicator" title={t("customActions.requiresShutdown")}>
                    <PowerIcon size="sm" />
                  </span>
                )}
              </button>
            )}
            {distro.version === 2 && (
              <button
                onClick={() => onAction("manage:compact")}
                data-testid="manage-action-compact"
                role="menuitem"
                className="w-full flex items-center gap-3 px-6 py-2 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
              >
                <span className="text-on-surface-variant"><CompressIcon size="sm" /></span>
                {t("manage.compact")}
              </button>
            )}
            <button
              onClick={() => onAction("manage:user")}
              data-testid="manage-action-user"
              role="menuitem"
              className="w-full flex items-center gap-3 px-6 py-2 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
            >
              <span className="text-on-surface-variant"><UserIcon size="sm" /></span>
              {t("manage.user")}
            </button>
            <button
              onClick={() => onAction("manage:rename")}
              disabled={!distro.id}
              data-testid="manage-action-rename"
              role="menuitem"
              className={`w-full flex items-center gap-3 px-6 py-2 text-sm text-left transition-all ${
                !distro.id
                  ? "text-outline cursor-not-allowed"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              <span className="text-on-surface-variant">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </span>
              {t("manage.rename")}
              {distro.state === "Running" && (
                <span className="ml-auto text-warning" data-testid="requires-stop-indicator" title={t("customActions.requiresStop")}>
                  <PauseIcon size="sm" />
                </span>
              )}
            </button>
            {distro.version === 2 && [true, false].map((enabled) => (
              <button
                key={enabled ? "sparse-enable" : "sparse-disable"}
                onClick={() => onAction(enabled ? "manage:sparse-enable" : "manage:sparse-disable")}
                data-testid={enabled ? "manage-action-sparse" : "manage-action-sparse-disable"}
                role="menuitem"
                className="w-full flex items-center justify-between px-6 py-2 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
              >
                <span className="flex items-center gap-3">
                  <span className="text-on-surface-variant"><SparklesIcon size="sm" /></span>
                  {t(enabled ? "manage.sparseEnable" : "manage.sparseDisable")}
                </span>
                {distro.state === "Running" && (
                  <span className="text-error" data-testid="requires-shutdown-indicator" title={t("customActions.requiresShutdown")}>
                    <PowerIcon size="sm" />
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={() => onAction("manage:setVersion")}
              data-testid="manage-action-set-version"
              role="menuitem"
              className="w-full flex items-center justify-between px-6 py-2 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
            >
              <span className="flex items-center gap-3">
                <span className="text-on-surface-variant">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </span>
                {t("manage.version")}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded bg-surface-container text-on-surface-variant border border-outline-variant">
                  v{distro.version}
                </span>
                {distro.state === "Running" && (
                  <span className="text-warning" data-testid="requires-stop-indicator" title={t("customActions.requiresStop")}>
                    <PauseIcon size="sm" />
                  </span>
                )}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Custom Actions */}
      {actions.length > 0 && (
        <>
          <div className="border-t border-outline-variant my-1" role="separator" />
          <div className="px-4 py-1.5 text-xs text-on-surface-variant uppercase tracking-wider font-mono">
            {t("customActions.title")}
          </div>
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => onAction(`custom:${action.id}`)}
              data-testid={`quick-action-custom-${action.id}`}
              role="menuitem"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
            >
              <Icon name={actionSymbol(action.icon)} size={20} />
              {action.name}
              <div className="ml-auto flex items-center gap-1.5">
                {action.requiresStopped && distro.state === "Running" && (
                  <span className="text-warning" data-testid="requires-stop-indicator" title={t("customActions.requiresStop")}>
                    <PauseIcon size="sm" />
                  </span>
                )}
                {action.requiresSudo && (
                  <Icon name="lock" size={16} className="text-on-surface-variant" label={t("requiresSudo")} />
                )}
              </div>
            </button>
    ))}
        </>
      )}
      </div>
    </div>
  );
}
