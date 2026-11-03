// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/m3-ai - A2ATaskTimeline
 *
 * Material Design 3 Agent-to-Agent Delegation Timeline:
 * - Chronological trace of task handoffs between agents (e.g., user -> agycli -> codex -> claude -> rag).
 * - Displays delegation phase, envelope kind, file claims, and execution status.
 */

import React, { useId, useState } from "react";
import { clsx } from "clsx";
import type { CoordEnvelope } from "./AgUiEventStream";

export interface TimelineStep {
  id: string;
  from: string;
  to: string;
  title: string;
  description?: string;
  status: "pending" | "running" | "completed" | "error";
  timestamp: string;
  envelope?: Partial<CoordEnvelope>;
  claim?: string;
}

export interface A2ATaskTimelineProps {
  steps?: TimelineStep[];
  currentStepId?: string;
  onSelectStep?: (step: TimelineStep) => void;
  className?: string;
}

const DEFAULT_TIMELINE_STEPS: TimelineStep[] = [
  {
    id: "step-agy-lead",
    from: "user",
    to: "agy",
    title: "Lead Coordination & Monorepo Integration",
    status: "completed",
    timestamp: "Live",
    description: "Coordination active via .coord mailbox and OS resource claims.",
  },
  {
    id: "step-workers",
    from: "agy",
    to: "codex",
    title: "Subagent / Peer Parallel Tasks",
    status: "running",
    timestamp: "Ongoing",
    description: "Workers executing disjoint task families under cooperatively acquired locks.",
  },
];

export const A2ATaskTimeline: React.FC<A2ATaskTimelineProps> = ({
  steps = DEFAULT_TIMELINE_STEPS,
  currentStepId,
  onSelectStep,
  className,
}) => {
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const timelineId = useId();

  const toggleExpand = (id: string) => {
    setExpandedStepId(current => (current === id ? null : id));
  };

  return (
    <div
      className={clsx(
        "flex flex-col gap-3 rounded-3xl p-5 border",
        "bg-surface-container-lowest",
        "border-outline-variant",
        "text-on-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-outline-variant/40 pb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-lg text-primary">timeline</span>
          <h3 className="text-sm font-semibold tracking-tight">A2A Task Delegation Timeline</h3>
        </div>
        <span className="text-xs text-outline">{steps.length} delegation steps</span>
      </div>

      <div className="relative flex flex-col gap-4 pl-4 pt-1">
        {/* Continuous connector line */}
        <div className="absolute left-[27px] top-4 bottom-4 w-0.5 bg-outline-variant/60" />

        {steps.map(step => {
          const isCurrent = step.id === currentStepId;
          const isExpanded = step.id === expandedStepId;
          const detailsId = `${timelineId}-${encodeURIComponent(step.id)}`;
          const date = new Date(step.timestamp);
          const time = Number.isNaN(date.getTime()) ? step.timestamp : date.toLocaleTimeString();

          const statusIcon =
            step.status === "completed"
              ? "check_circle"
              : step.status === "running"
                ? "sync"
                : step.status === "error"
                  ? "error"
                  : "radio_button_unchecked";

          const statusColor =
            step.status === "completed"
              ? "text-success"
              : step.status === "running"
                ? "text-primary animate-spin motion-reduce:animate-none"
                : step.status === "error"
                  ? "text-error"
                  : "text-outline";

          return (
            <div
              key={step.id}
              className={clsx("relative flex items-start gap-3 transition-all", isCurrent && "font-medium")}
            >
              {/* Step indicator node */}
              <div
                className={clsx(
                  "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-surface-container-lowest",
                  step.status === "completed"
                    ? "border-success"
                    : step.status === "running"
                      ? "border-primary ring-4 ring-primary/20"
                      : step.status === "error"
                        ? "border-error"
                        : "border-outline-variant",
                )}
              >
                <span className={clsx("material-symbols-outlined text-sm", statusColor)}>{statusIcon}</span>
              </div>

              {/* Step details card */}
              <div
                className={clsx(
                  "flex-1 cursor-pointer rounded-2xl border p-3 text-xs transition-all",
                  "bg-surface-container-low hover:bg-surface-container",
                  isCurrent ? "border-primary shadow-sm" : "border-outline-variant/60",
                )}
              >
                <button
                  type="button"
                  aria-expanded={step.envelope ? isExpanded : undefined}
                  aria-controls={step.envelope ? detailsId : undefined}
                  onClick={() => {
                    toggleExpand(step.id);
                    onSelectStep?.(step);
                  }}
                  className="block w-full rounded-medium text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-on-surface">{step.title}</span>
                      <span className="rounded-md bg-surface-container-highest px-1.5 py-0.2 text-[10px] font-mono text-on-surface-variant">
                        @{step.from} → @{step.to}
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-outline">{time}</span>
                  </span>

                  {step.description && (
                    <span className="mt-1 block text-xs text-on-surface-variant">{step.description}</span>
                  )}

                  {step.claim && (
                    <span className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-warning">
                      <span className="material-symbols-outlined text-xs">lock</span>
                      <span>claim: {step.claim}</span>
                    </span>
                  )}
                </button>

                {/* Expanded envelope payload view */}
                {step.envelope && (
                  <div
                    id={detailsId}
                    hidden={!isExpanded}
                    className="mt-2.5 pt-2 border-t border-outline-variant/40 font-mono text-[11px] text-on-surface-variant"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">Kind: {step.envelope.kind}</span>
                      <span>·</span>
                      <span>Topic: {step.envelope.topic}</span>
                    </div>
                    {step.envelope.body && (
                      <pre className="rounded-lg bg-surface-container-highest/50 p-2 overflow-x-auto whitespace-pre-wrap">
                        {step.envelope.body}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
