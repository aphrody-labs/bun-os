// SPDX-License-Identifier: Apache-2.0
// Keyboard events to the bytes a terminal sends a pty (xterm conventions), for the guest shell's stdin.

const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);

const KEYS: Record<string, string> = {
  Enter: "\r",
  Backspace: DEL,
  Tab: "\t",
  Escape: ESC,
  Delete: `${ESC}[3~`,
  Insert: `${ESC}[2~`,
  Home: `${ESC}[H`,
  End: `${ESC}[F`,
  PageUp: `${ESC}[5~`,
  PageDown: `${ESC}[6~`,
  ArrowUp: `${ESC}[A`,
  ArrowDown: `${ESC}[B`,
  ArrowRight: `${ESC}[C`,
  ArrowLeft: `${ESC}[D`,
};

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** The bytes for a key press, or undefined when the key is not for the guest (shortcuts, modifiers alone). */
export function keyToBytes(e: KeyLike): string | undefined {
  if (e.metaKey) return undefined;
  if (e.ctrlKey && !e.altKey && e.key.length === 1) {
    const c = e.key.toLowerCase().charCodeAt(0);
    if (c >= 97 && c <= 122) return String.fromCharCode(c - 96); // ^A..^Z
    if (e.key === "[") return ESC;
    if (e.key === "\\") return String.fromCharCode(28);
    if (e.key === "]") return String.fromCharCode(29);
    if (e.key === " " || e.key === "@") return String.fromCharCode(0);
    return undefined;
  }
  const named = KEYS[e.key];
  if (named !== undefined) return e.shiftKey && e.key === "Tab" ? `${ESC}[Z` : named;
  if (e.key.length === 1 || [...e.key].length === 1) return e.altKey ? `${ESC}${e.key}` : e.key;
  return undefined;
}
