import React, { type CSSProperties } from "react";

export interface MetricBadgeProps {
  label: string;
  value: string | number;
  unit?: string;
  status?: "normal" | "accent" | "warning" | "error" | "success";
  className?: string;
  style?: CSSProperties;
}

export const MetricBadge: React.FC<MetricBadgeProps> = ({
  label,
  value,
  unit,
  status = "normal",
  className = "",
  style,
}) => {
  const getStatusColor = () => {
    switch (status) {
      case "accent":
        return "var(--craft-primary, #64a0ff)";
      case "warning":
        return "var(--craft-warning, #fbbf24)";
      case "error":
        return "var(--craft-error, #f87171)";
      case "success":
        return "var(--craft-success, #34d399)";
      case "normal":
      default:
        return "var(--craft-on-surface-variant, #94a3b8)";
    }
  };

  return (
    <div
      className={`craft-metric-badge ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "6px",
        padding: "4px 10px",
        borderRadius: "8px",
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(255, 255, 255, 0.07)",
        fontFamily: "var(--craft-font-code, monospace)",
        fontSize: "12px",
        color: "var(--craft-on-surface, #f1f5f9)",
        ...style,
      }}
    >
      <span style={{ fontSize: "11px", color: getStatusColor(), textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, color: "#ffffff" }}>{value}</span>
      {unit && <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>{unit}</span>}
    </div>
  );
};
