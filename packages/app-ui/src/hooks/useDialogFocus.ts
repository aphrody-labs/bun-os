// SPDX-License-Identifier: Apache-2.0
import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Open dialogs, innermost last: only the innermost one handles Escape and Tab. */
const stack: object[] = [];

function focusables(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

export interface DialogFocusOptions {
  open: boolean;
  /** Called on Escape. Omit when the component already handles Escape itself. */
  onEscape?: () => void;
  /** Keep Tab and Shift+Tab inside the dialog (default true). */
  trap?: boolean;
  /** Element focused on open; defaults to the first focusable descendant, then the dialog itself. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * Modal dialog focus management for hand-built overlays: moves focus into the dialog on open,
 * handles Escape, keeps Tab inside it, and returns focus to the previously focused element on close.
 * Give the dialog element `tabIndex={-1}` so it can hold focus when it has no focusable content.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  { open, onEscape, trap = true, initialFocus }: DialogFocusOptions,
): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const token = {};
    stack.push(token);
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frame = requestAnimationFrame(() => {
      const node = ref.current;
      if (!node || node.contains(document.activeElement)) return;
      (initialFocus?.current ?? focusables(node)[0] ?? node).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const node = ref.current;
      if (!node || event.defaultPrevented || stack.at(-1) !== token) return;
      if (event.key === "Escape") {
        if (!onEscapeRef.current) return;
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (!trap || event.key !== "Tab") return;
      const items = focusables(node);
      const active = document.activeElement;
      if (items.length === 0) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey ? active === first || !node.contains(active) : active === last || !node.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      const index = stack.indexOf(token);
      if (index !== -1) stack.splice(index, 1);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [open, trap, ref, initialFocus]);
}
