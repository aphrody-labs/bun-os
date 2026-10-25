// SPDX-License-Identifier: Apache-2.0
// Shared Material Design 3 building blocks for @aphrody/m3-ai (internal, not exported).

import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import type { ReactNode } from "react";

/** The M3 focus indicator (contract: docs/design/SPACEUI-M3-FUSION.md, "States"). */
export const focusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2";

/** Expand / collapse: enter on emphasized decelerate, exit on emphasized accelerate. */
export const expandMotion = {
  initial: { height: 0, opacity: 0 },
  animate: {
    height: "auto",
    opacity: 1,
    transition: {
      duration: m3Durations.medium2,
      ease: m3Easings.emphasizedDecelerate,
    },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: {
      duration: m3Durations.short4,
      ease: m3Easings.emphasizedAccelerate,
    },
  },
} as const;

/**
 * Indeterminate M3 circular progress indicator (active indicator on `primary` or the current
 * color, 4 dp track gap omitted at small sizes). Replaces the upstream Grid loader.
 */
export function CircularIndicator({
  size = 16,
  className,
  label = "Loading",
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  const stroke = size <= 16 ? 2 : size <= 24 ? 3 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 circular indeterminate indicator is an animated SVG arc; a native <progress> cannot render it.
      role="progressbar"
      aria-label={label}
      className={clsx("m3-circular-indicator inline-flex shrink-0 text-primary", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="animate-spin" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * 0.7} ${c}`}
        />
      </svg>
    </span>
  );
}

export type ChipTone = "primary" | "success" | "error" | "warning" | "neutral";

const chipTones: Record<ChipTone, string> = {
  primary: "bg-primary-container text-on-primary-container",
  success: "bg-success-container text-on-success-container",
  error: "bg-error-container text-on-error-container",
  warning: "bg-warning-container text-on-warning-container",
  neutral: "border border-outline-variant text-on-surface-variant",
};

/** Non-interactive M3 assist chip used as a status label (dense, `rounded-small`). */
export function StatusChip({
  tone,
  icon,
  children,
  className,
}: {
  tone: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-small px-2 text-label-medium",
        chipTones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
