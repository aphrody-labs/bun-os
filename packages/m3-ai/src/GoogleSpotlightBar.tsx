// SPDX-License-Identifier: Apache-2.0
// Benchmark: assets/ui/google-desktop-spotlight-bar.png (manifest item 1)
// Dimensions: ~1266x450px, border-radius 32dp (BRAND_CORNER_PROMPT_BAR_PX), Alt + Space capsule

"use client";

import { CircleButton, Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { type ReactNode, useState } from "react";

// design:content - the four-colour Google "G" mark is logo artwork, not UI chrome.
const GOOGLE_G_LOGO = Object.freeze({ blue: "#4285F4", green: "#34A853", yellow: "#FBBC05", red: "#EA4335" } as const);

export interface GoogleSpotlightBarProps {
  /** Placeholder text */
  placeholder?: string;
  /** Active query draft */
  query?: string;
  /** On change callback */
  onQueryChange?: (val: string) => void;
  /** Triggered on submit */
  onSubmit?: (query: string) => void;
  /** File/attachment action handler */
  onAttach?: () => void;
  /** Screen capture / share window handler */
  onScreenCapture?: () => void;
  /** Google Lens multimodal query handler */
  onGoogleLens?: () => void;
  /** User avatar element or image URL */
  avatar?: ReactNode;
  /** Additional container classes */
  className?: string;
}

/**
 * Floating Spotlight Assistant Bar & Search Capsule (Alt + Space).
 * Benchmark parity: `google-desktop-spotlight-bar.png` (manifest item 1).
 * Features:
 * - Floating translucent frameless capsule with 32dp corner radius (--gemini-corner-prompt-bar).
 * - Soft desktop elevation shadow.
 * - Global shortcut pill indicator ('Alt + Space').
 * - Multimodal action buttons (+ for attach, screen capture, Google Lens).
 */
export function GoogleSpotlightBar({
  placeholder = "Ask anything or start typing...",
  query: controlledQuery,
  onQueryChange,
  onSubmit,
  onAttach,
  onScreenCapture,
  onGoogleLens,
  avatar,
  className,
}: GoogleSpotlightBarProps) {
  const [internalQuery, setInternalQuery] = useState("");
  const query = controlledQuery !== undefined ? controlledQuery : internalQuery;

  const handleChange = (val: string) => {
    if (controlledQuery === undefined) {
      setInternalQuery(val);
    }
    onQueryChange?.(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim().length > 0) {
      e.preventDefault();
      onSubmit?.(query);
    }
  };

  return (
    <search
      aria-label="Google Spotlight Assistant"
      className={clsx(
        "google-spotlight-capsule relative mx-auto flex w-full max-w-[840px] items-center gap-3",
        "rounded-[var(--gemini-corner-prompt-bar,32px)] bg-surface-container-high/90 px-5 py-3.5 backdrop-blur-xl",
        "border border-outline-variant/30 text-on-surface shadow-md3-3 transition-all duration-200",
        "focus-within:border-primary/50 focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-secondary focus-within:bg-surface-container-highest/95 focus-within:shadow-md3-4",
        className,
      )}
    >
      {/* Google Colorful G Logo */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            fill={GOOGLE_G_LOGO.blue}
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.64v3.03h3.88c2.27-2.09 3.665-5.17 3.665-9.11z"
          />
          <path
            fill={GOOGLE_G_LOGO.green}
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.13C3.28 21.43 7.33 24 12 24z"
          />
          <path
            fill={GOOGLE_G_LOGO.yellow}
            d="M5.28 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.57H1.25C.45 8.16 0 9.98 0 12s.45 3.84 1.25 5.43l4.03-3.14z"
          />
          <path
            fill={GOOGLE_G_LOGO.red}
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.28 2.57 1.25 6.57l4.03 3.14c.95-2.83 3.6-4.96 6.72-4.96z"
          />
        </svg>
      </div>

      {/* Main multimodal text input */}
      <input
        type="text"
        value={query}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="block flex-1 border-0 bg-transparent px-1 text-body-large text-on-surface caret-primary outline-none placeholder:text-on-surface-variant focus:outline-none focus:ring-0"
      />

      {/* Multimodal Actions (Attach, Screen, Lens) */}
      <div className="flex shrink-0 items-center gap-1.5">
        {onAttach && (
          <CircleButton
            variant="standard"
            size="sm"
            onClick={onAttach}
            aria-label="Add attachments"
            title="Attach file"
          >
            <Icon name="add" size={20} />
          </CircleButton>
        )}

        {onScreenCapture && (
          <CircleButton
            variant="standard"
            size="sm"
            onClick={onScreenCapture}
            aria-label="Capture screen"
            title="Share or capture screen"
          >
            <Icon name="screenshot" size={20} />
          </CircleButton>
        )}

        {onGoogleLens && (
          <CircleButton
            variant="standard"
            size="sm"
            onClick={onGoogleLens}
            aria-label="Google Lens"
            title="Search with Google Lens"
          >
            <Icon name="center_focus_strong" size={20} />
          </CircleButton>
        )}

        {/* Global Shortcut Pill: Alt + Space */}
        <div
          aria-hidden="true"
          className="ml-1 hidden select-none items-center rounded-full bg-surface-container px-2.5 py-1 text-label-small font-medium text-on-surface-variant sm:flex"
        >
          Alt + Space
        </div>

        {/* User avatar if provided */}
        {avatar && <div className="ml-1 shrink-0">{avatar}</div>}
      </div>
    </search>
  );
}
