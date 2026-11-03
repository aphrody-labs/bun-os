// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/m3-ai - McpAppCard
 *
 * Material Design 3 Interactive MCP App Container:
 * - Renders generative UI resources produced by MCP tools (SEP-1724 / mcp-ui).
 * - Hosts interactive guest web applications in an isolated sandbox iframe.
 * - Passes reactive M3 theme and color scheme context to the guest app.
 * - Supports expandable full-bleed or embedded card layouts.
 */

import React, { useState, useRef, useMemo } from "react";
import { clsx } from "clsx";
import { AppRenderer, type SandboxConfig, type McpUiHostContext } from "@aphrody/mcp-ui";

export interface McpAppCardProps {
  toolName: string;
  title?: string;
  html?: string;
  toolResourceUri?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: any;
  sandboxUrl?: string;
  isExpandedDefault?: boolean;
  className?: string;
  onAction?: (action: string, payload?: unknown) => void;
}

export const McpAppCard: React.FC<McpAppCardProps> = ({
  toolName,
  title,
  html,
  toolResourceUri,
  toolInput,
  toolResult,
  sandboxUrl,
  isExpandedDefault = false,
  className,
  onAction: _onAction,
}) => {
  const [isExpanded, setIsExpanded] = useState(isExpandedDefault);
  const [hasError, setHasError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Host context with Material Design 3 tokens
  const hostContext: McpUiHostContext = useMemo(() => {
    const isDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      theme: isDark ? "dark" : "light",
      locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
      displayMode: isExpanded ? "fullscreen" : "inline",
    };
  }, [isExpanded]);

  // Fallback default sandbox proxy URL
  const resolvedSandbox: SandboxConfig = useMemo(() => {
    const url = sandboxUrl ? new URL(sandboxUrl) : new URL("https://mcpui.dev/sandbox_proxy.html");
    return {
      url,
      permissions: "allow-scripts allow-forms allow-same-origin",
    };
  }, [sandboxUrl]);

  return (
    <div
      ref={containerRef}
      className={clsx(
        "flex flex-col rounded-3xl border transition-all duration-300 overflow-hidden",
        "bg-surface-container-low",
        "border-outline-variant",
        "text-on-surface",
        isExpanded ? "fixed inset-4 z-50 shadow-2xl" : "relative w-full shadow-sm",
        className,
      )}
    >
      {/* App Card Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/40 bg-surface-container/60">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
            <span className="material-symbols-outlined text-base">widgets</span>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-tight">{title || toolName}</span>
              <span className="rounded-full bg-surface-container-high px-2 py-0.2 text-[10px] font-mono text-on-surface-variant">
                mcp-ui
              </span>
            </div>
            {toolResourceUri && <span className="text-[10px] font-mono text-outline">{toolResourceUri}</span>}
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 rounded-full bg-success-container px-2 py-0.5 text-[10px] font-medium text-on-success-container">
            <span className="material-symbols-outlined text-xs">verified_user</span>
            <span>Sandboxed</span>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse" : "Expand Fullscreen"}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-base">
              {isExpanded ? "close_fullscreen" : "open_in_full"}
            </span>
          </button>
        </div>
      </div>

      {/* App Frame Content */}
      <div
        className={clsx("relative w-full overflow-hidden transition-all", isExpanded ? "flex-1 min-h-[500px]" : "h-96")}
      >
        {hasError ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-error">
            <span className="material-symbols-outlined text-3xl mb-1">error</span>
            <span className="font-semibold">MCP App Render Error</span>
            <p className="mt-1 font-mono text-[11px] opacity-80">{hasError}</p>
          </div>
        ) : html ? (
          <AppRenderer
            toolName={toolName}
            html={html}
            sandbox={resolvedSandbox}
            toolInput={toolInput}
            toolResult={toolResult}
            hostContext={hostContext}
            onError={err => setHasError(err.message)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-6 text-xs text-outline">
            <span className="material-symbols-outlined text-2xl animate-spin mb-1 text-primary">progress_activity</span>
            <span>Awaiting MCP UI Resource ({toolName})...</span>
          </div>
        )}
      </div>

      {/* Footer info */}
      {toolInput && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-outline-variant/30 bg-surface-container-lowest text-[10px] text-outline font-mono">
          <span className="truncate">input: {JSON.stringify(toolInput)}</span>
          <span className="shrink-0 ml-2">M3 UI Bridge</span>
        </div>
      )}
    </div>
  );
};
