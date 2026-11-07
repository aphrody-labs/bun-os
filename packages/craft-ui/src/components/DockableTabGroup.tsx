import React, { type CSSProperties, type ReactNode } from "react";

export interface DockTabItem {
  id: string;
  title: string;
  icon?: ReactNode;
  isDirty?: boolean;
  pinned?: boolean;
}

export interface DockableTabGroupProps {
  tabs: DockTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onNewTab?: () => void;
  className?: string;
  style?: CSSProperties;
}

export const DockableTabGroup: React.FC<DockableTabGroupProps> = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNewTab,
  className = "",
  style,
}) => {
  return (
    <div
      className={`craft-tab-group ${className}`}
      style={{
        display: "flex",
        alignItems: "center",
        height: "36px",
        background: "var(--craft-surface-container-lowest, rgba(10, 14, 20, 0.95))",
        borderBottom: "1px solid var(--craft-outline-variant, rgba(255,255,255,0.08))",
        overflowX: "auto",
        scrollbarWidth: "none",
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              height: "100%",
              padding: "0 14px",
              fontSize: "12px",
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "var(--craft-on-surface, #f8fafc)" : "var(--craft-on-surface-variant, #94a3b8)",
              background: isActive ? "var(--craft-surface-container-high, rgba(30, 41, 59, 0.7))" : "transparent",
              borderRight: "1px solid rgba(255,255,255,0.06)",
              borderTop: isActive ? "2px solid var(--craft-primary, #64a0ff)" : "2px solid transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
              userSelect: "none",
              transition: "all 140ms ease-out",
            }}
          >
            {tab.icon}
            <span>{tab.title}</span>
            {tab.isDirty && (
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "var(--craft-tertiary, #fbbf24)",
                }}
              />
            )}
            {onClose && !tab.pinned && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "16px",
                  height: "16px",
                  borderRadius: "4px",
                  opacity: 0.6,
                  marginLeft: "4px",
                  fontSize: "11px",
                }}
              >
                ✕
              </span>
            )}
          </div>
        );
      })}

      {onNewTab && (
        <button
          onClick={onNewTab}
          title="New document"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "100%",
            background: "transparent",
            border: "none",
            color: "var(--craft-on-surface-variant, #94a3b8)",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          +
        </button>
      )}
    </div>
  );
};
