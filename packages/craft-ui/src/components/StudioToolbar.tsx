import React, { type CSSProperties, type ReactNode } from "react";

export interface ToolbarAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface StudioToolbarProps {
  appName: string;
  version?: string;
  actions: ToolbarAction[];
  rightContent?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export const StudioToolbar: React.FC<StudioToolbarProps> = ({
  appName,
  version = "1.4.7",
  actions,
  rightContent,
  className = "",
  style,
}) => {
  return (
    <header
      className={`craft-studio-toolbar ${className}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "48px",
        padding: "0 16px",
        background: "var(--craft-surface-container-low, rgba(14, 18, 26, 0.85))",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--craft-outline-variant, rgba(255,255,255,0.08))",
        boxShadow: "0 1px 0 0 rgba(255,255,255,0.06)",
        userSelect: "none",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "6px",
              background: "linear-gradient(135deg, var(--craft-primary, #64a0ff), var(--craft-secondary, #ab7eff))",
              boxShadow: "0 2px 8px rgba(100, 160, 255, 0.35)",
            }}
          />
          <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--craft-on-surface, #f0f4fc)", letterSpacing: "-0.01em" }}>
            {appName}
          </span>
          <span
            style={{
              fontSize: "11px",
              padding: "1px 6px",
              borderRadius: "9999px",
              background: "rgba(255,255,255,0.08)",
              color: "var(--craft-on-surface-variant, #94a3b8)",
              fontFamily: "var(--craft-font-code, monospace)",
            }}
          >
            v{version}
          </span>
        </div>

        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />

        {/* Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {actions.map((act) => (
            <button
              key={act.id}
              onClick={act.onClick}
              disabled={act.disabled}
              title={act.shortcut ? `${act.label} (${act.shortcut})` : act.label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                color: act.active ? "var(--craft-on-primary-container, #ffffff)" : "var(--craft-on-surface-variant, #cbd5e1)",
                background: act.active ? "var(--craft-primary-container, rgba(100, 160, 255, 0.2))" : "transparent",
                border: act.active ? "1px solid rgba(100, 160, 255, 0.3)" : "1px solid transparent",
                cursor: act.disabled ? "not-allowed" : "pointer",
                opacity: act.disabled ? 0.4 : 1,
                transition: "all 180ms ease-out",
              }}
            >
              {act.icon}
              <span>{act.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {rightContent}
      </div>
    </header>
  );
};
