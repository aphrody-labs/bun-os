// SPDX-License-Identifier: Apache-2.0

// The titlebar paints with the generated roles and the static scale (typescale, motion, state layers).
import "@aphrody/m3-tokens/m3-tokens.css";
import "../tokens.css";
import React, { useEffect, useState } from "react";
import { useM3Theme } from "./react";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: any) => Promise<any>;
      transformCallback: (callback?: (response: any) => void, once?: boolean) => number;
      unregisterCallback: (id: number) => void;
    };
  }
}

/** Whether the page runs inside a Tauri webview (false during SSR). */
function detectTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

/** Invoke a Tauri window command, ignoring failures (restricted capability, browser preview). */
function invokeWindow(command: string, args?: Record<string, unknown>): Promise<unknown> {
  return window.__TAURI_INTERNALS__?.invoke(command, args).catch(() => undefined) ?? Promise.resolve(undefined);
}

const minimizeWindow = () => void invokeWindow("plugin:window|minimize");
const closeWindow = () => void invokeWindow("plugin:window|close");

/**
 * A custom React hook that automatically synchronizes the M3 theme mode
 * (light/dark) back to the Tauri native window context.
 */
export function useM3TauriThemeSync() {
  const { resolvedTheme } = useM3Theme();
  const [isTauri] = useState(detectTauri);

  useEffect(() => {
    if (!isTauri) return;
    // Tauri 2 window set_theme accepts the parameter 'value' rather than 'theme'.
    void invokeWindow("plugin:window|set_theme", { value: resolvedTheme });
  }, [isTauri, resolvedTheme]);

  return { isTauri };
}

export interface M3TauriTitlebarProps {
  /** The title to display in the titlebar. */
  title?: string;
  /** Custom logo or icon component to display on the left. */
  logo?: React.ReactNode;
  /** Force show even if not running inside Tauri (useful for preview/styling). */
  forceShow?: boolean;
  /** Custom style overrides. */
  style?: React.CSSProperties;
  /** Right-aligned custom actions/elements. */
  extraActions?: React.ReactNode;
}

interface WindowControlProps {
  label: string;
  onClick: () => void;
  /** Close uses the error role on hover/focus, the others an 8 % on-surface state layer. */
  danger?: boolean;
  children: React.ReactNode;
}

/** A caption button: hover and keyboard focus show the same M3 state. */
function WindowControl({ label, onClick, danger = false, children }: WindowControlProps) {
  const [active, setActive] = useState(false);
  const on = () => setActive(true);
  const off = () => setActive(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={on}
      onMouseLeave={off}
      onFocus={on}
      onBlur={off}
      style={{
        background: active
          ? danger
            ? "var(--md-sys-color-error)"
            : "color-mix(in srgb, var(--md-sys-color-on-surface) calc(var(--md-sys-state-hover-state-layer-opacity) * 100%), transparent)"
          : "transparent",
        border: "none",
        color: active && danger ? "var(--md-sys-color-on-error)" : "inherit",
        cursor: "pointer",
        width: "46px",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition:
          "background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard), color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * A highly polished, M3-themed custom titlebar component for Tauri 2 windows.
 * Hides automatically when running in a normal web browser.
 */
export function M3TauriTitlebar({ title, logo, forceShow = false, style, extraActions }: M3TauriTitlebarProps) {
  const { isTauri } = useM3TauriThemeSync();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    // Track the maximize state: resizing happens on maximize, restore and manual resizes.
    const checkMaximized = () => {
      void invokeWindow("plugin:window|is_maximized").then(maximized => setIsMaximized(Boolean(maximized)));
    };
    checkMaximized();
    window.addEventListener("resize", checkMaximized);
    return () => window.removeEventListener("resize", checkMaximized);
  }, [isTauri]);

  if (!forceShow && !isTauri) return null;

  const toggleMaximize = () => {
    void invokeWindow(isMaximized ? "plugin:window|unmaximize" : "plugin:window|maximize").then(() =>
      setIsMaximized(!isMaximized),
    );
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "36px",
        background: "var(--md-sys-color-surface-container)",
        color: "var(--md-sys-color-on-surface)",
        userSelect: "none",
        fontFamily: "var(--md-sys-typescale-label-medium-font)",
        fontSize: "var(--md-sys-typescale-label-medium-size)",
        lineHeight: "var(--md-sys-typescale-label-medium-line-height)",
        letterSpacing: "var(--md-sys-typescale-label-medium-tracking)",
        fontWeight: "var(--md-sys-typescale-label-medium-weight)",
        borderBottom: "1px solid var(--md-sys-color-outline-variant)",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {/* Drag region covering the titlebar */}
      <div
        data-tauri-drag-region
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "36px",
          zIndex: 1,
        }}
      />

      {/* Left items: Logo & Title */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingLeft: "12px",
          zIndex: 2,
        }}
      >
        {logo}
        <span>{title}</span>
      </div>

      {/* Right items: Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "100%",
          zIndex: 2,
        }}
      >
        {extraActions}

        <WindowControl label="Minimize" onClick={minimizeWindow}>
          <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
            <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowControl>

        <WindowControl label={isMaximized ? "Restore" : "Maximize"} onClick={toggleMaximize}>
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M2.5,1.5 L2.5,2.5 L1.5,2.5 L1.5,8.5 L7.5,8.5 L7.5,7.5 L8.5,7.5 L8.5,1.5 Z M7.5,2.5 L7.5,7.5 L2.5,7.5 L2.5,2.5 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </WindowControl>

        <WindowControl label="Close" onClick={closeWindow} danger>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5,1.5 L8.5,8.5 M8.5,1.5 L1.5,8.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowControl>
      </div>
    </div>
  );
}
