import React, { type CSSProperties, type ReactNode } from "react";

export interface GlassPanelProps {
  children?: ReactNode;
  elevation?: 0 | 1 | 2 | 3 | 4;
  variant?: "surface" | "floating" | "modal" | "dock";
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  elevation = 2,
  variant = "surface",
  className = "",
  style,
  onClick,
}) => {
  const getElevationStyle = (): CSSProperties => {
    switch (elevation) {
      case 1:
        return {
          boxShadow: "0 1px 2px 0 rgba(0,0,0,0.05), inset 0 1px 0 0 rgba(255,255,255,0.08)",
        };
      case 2:
        return {
          boxShadow: "0 4px 12px -2px rgba(0,0,0,0.18), inset 0 1px 0 0 rgba(255,255,255,0.1)",
        };
      case 3:
        return {
          boxShadow: "0 8px 24px -4px rgba(0,0,0,0.28), inset 0 1px 0 0 rgba(255,255,255,0.14)",
        };
      case 4:
        return {
          boxShadow: "0 16px 48px -8px rgba(0,0,0,0.42), inset 0 1px 0 0 rgba(255,255,255,0.18)",
        };
      default:
        return {};
    }
  };

  const getVariantStyle = (): CSSProperties => {
    switch (variant) {
      case "floating":
        return {
          background: "var(--craft-glass-surface, rgba(16, 22, 32, 0.78))",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid var(--craft-glass-border, rgba(255,255,255,0.12))",
          borderRadius: "16px",
        };
      case "modal":
        return {
          background: "var(--craft-glass-surface, rgba(14, 18, 26, 0.88))",
          backdropFilter: "blur(32px) saturate(200%)",
          WebkitBackdropFilter: "blur(32px) saturate(200%)",
          border: "1px solid var(--craft-glass-border, rgba(255,255,255,0.16))",
          borderRadius: "20px",
        };
      case "dock":
        return {
          background: "var(--craft-glass-surface, rgba(12, 16, 24, 0.75))",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          border: "1px solid var(--craft-glass-border, rgba(255,255,255,0.08))",
          borderRadius: "12px",
        };
      case "surface":
      default:
        return {
          background: "var(--craft-surface-container, rgba(18, 24, 34, 0.65))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid var(--craft-glass-border, rgba(255,255,255,0.08))",
          borderRadius: "12px",
        };
    }
  };

  return (
    <div
      onClick={onClick}
      className={`craft-glass-panel ${className}`}
      style={{
        position: "relative",
        overflow: "hidden",
        transition: "box-shadow 260ms cubic-bezier(0.19, 1, 0.22, 1), transform 260ms cubic-bezier(0.19, 1, 0.22, 1)",
        ...getVariantStyle(),
        ...getElevationStyle(),
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "1px",
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18) 35%, rgba(255,255,255,0.18) 65%, transparent)",
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
};
