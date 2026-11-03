/**
 * Application mark: the Material Symbols "terminal" glyph on the primary container, so it follows
 * the active seed like the rest of the UI.
 */

import { Icon } from "@aphrody/m3-primitives";

interface AppMarkProps {
  /** Edge length in px. */
  size?: number;
  className?: string;
}

export function AppMark({ size = 32, className = "" }: AppMarkProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[22%] bg-primary-container text-on-primary-container ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon name="terminal" size={Math.round(size * 0.66)} weight={500} />
    </span>
  );
}
