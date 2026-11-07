import React, { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface VelocityButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "glass" | "danger";
  size?: "sm" | "md" | "lg";
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const VelocityButton: React.FC<VelocityButtonProps> = ({
  children,
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  style,
  disabled,
  ...props
}) => {
  const [isPressed, setIsPressed] = useState(false);

  const getSizeStyle = () => {
    switch (size) {
      case "sm":
        return { padding: "6px 12px", fontSize: "12px", borderRadius: "8px", gap: "6px" };
      case "lg":
        return { padding: "12px 24px", fontSize: "15px", borderRadius: "12px", gap: "10px" };
      case "md":
      default:
        return { padding: "8px 18px", fontSize: "13px", borderRadius: "10px", gap: "8px" };
    }
  };

  const getVariantStyle = () => {
    switch (variant) {
      case "glass":
        return {
          background: "var(--craft-glass-surface, rgba(255, 255, 255, 0.08))",
          backdropFilter: "blur(16px)",
          color: "var(--craft-on-surface, #f8fafc)",
          border: "1px solid var(--craft-glass-border, rgba(255, 255, 255, 0.12))",
          boxShadow: isPressed
            ? "0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)"
            : "0 4px 14px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.18)",
        };
      case "secondary":
        return {
          background: "var(--craft-secondary-container, rgba(40, 50, 70, 0.8))",
          color: "var(--craft-on-secondary-container, #e2e8f0)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: isPressed ? "none" : "0 2px 6px rgba(0,0,0,0.15)",
        };
      case "danger":
        return {
          background: "var(--craft-error, #ef4444)",
          color: "var(--craft-on-error, #ffffff)",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: isPressed ? "none" : "0 4px 12px rgba(239, 68, 68, 0.35)",
        };
      case "primary":
      default:
        return {
          background: "linear-gradient(180deg, var(--craft-primary, #64a0ff) 0%, #3b82f6 100%)",
          color: "var(--craft-on-primary, #050b14)",
          border: "1px solid rgba(255,255,255,0.25)",
          boxShadow: isPressed
            ? "0 1px 2px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.2)"
            : "0 4px 16px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255,255,255,0.35)",
        };
    }
  };

  return (
    <button
      disabled={disabled}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontFamily: "var(--craft-font-display, inherit)",
        letterSpacing: "-0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transform: isPressed ? "scale(0.975) translateY(1px)" : "scale(1.0)",
        transition: "transform 140ms cubic-bezier(0.19, 1, 0.22, 1), box-shadow 140ms cubic-bezier(0.19, 1, 0.22, 1)",
        userSelect: "none",
        ...getSizeStyle(),
        ...getVariantStyle(),
        ...style,
      }}
      {...props}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
};
