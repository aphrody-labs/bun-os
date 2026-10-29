// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { buildMessages, type AssistantBackend, type Excerpt } from "./backend";
import { ShakeDetector } from "./shake";

export interface AssistantDeps {
  /** Backend built from the preferences at the time of the question (so Settings changes apply at once). */
  backend: () => AssistantBackend;
  /** Content index lookup (BM25 over the user's files). */
  search: (query: string) => Excerpt[];
  /** Whether the gesture is active (Settings). */
  enabled: () => boolean;
  /** Where the overlay mounts. */
  host?: HTMLElement;
  detector?: ShakeDetector;
}

export interface AssistantHandle {
  open(near?: { x: number; y: number }): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

/**
 * "Wiggle the pointer to ask": a shake of the pointer opens a prompt next to it; the answer streams from the configured
 * backend, with excerpts of the user's own files from the content index as context.
 */
export function installAssistant(deps: AssistantDeps): AssistantHandle {
  const host = deps.host ?? document.body;
  const detector = deps.detector ?? new ShakeDetector();
  let panel: HTMLElement | undefined;
  let controller: AbortController | undefined;

  const close = () => {
    controller?.abort();
    controller = undefined;
    panel?.remove();
    panel = undefined;
  };

  const ask = async (question: string, answer: HTMLElement, sources: HTMLElement) => {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    answer.textContent = "";
    answer.dataset.state = "thinking";
    sources.replaceChildren();
    let excerpts: Excerpt[] = [];
    try {
      excerpts = deps.search(question).slice(0, 5);
    } catch {
      // the index is optional context
    }
    for (const e of excerpts) sources.append(h("li", { class: "assist-src" }, `${e.path}:${e.line}`));
    try {
      for await (const piece of deps.backend().ask(buildMessages(question, excerpts), signal)) {
        answer.dataset.state = "streaming";
        answer.textContent += piece;
      }
      answer.dataset.state = "done";
    } catch (error) {
      if (signal.aborted) return;
      answer.dataset.state = "error";
      answer.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  const open = (near?: { x: number; y: number }) => {
    if (panel) return panel.querySelector<HTMLInputElement>("input")?.focus();
    const input = h("input", {
      class: "fld assist-in",
      type: "text",
      "aria-label": "Ask the assistant",
      placeholder: "Ask about what is on screen or in your files",
      autocomplete: "off",
      spellcheck: "false",
    }) as HTMLInputElement;
    const answer = h("div", { class: "assist-out", "aria-live": "polite", role: "status" });
    const sources = h("ul", { class: "assist-srcs", "aria-label": "Files used" });
    panel = h(
      "section",
      { class: "assist", role: "dialog", "aria-modal": "false", "aria-label": "Assistant" },
      h("div", { class: "assist-head" }, h("span", { class: "assist-title" }, "Ask"), h("kbd", {}, "Esc")),
      input,
      answer,
      sources,
    );
    if (near) {
      panel.style.left = `${Math.max(8, Math.min(near.x - 24, window.innerWidth - 440))}px`;
      panel.style.top = `${Math.max(8, Math.min(near.y + 16, window.innerHeight - 260))}px`;
    }
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && input.value.trim()) {
        e.preventDefault();
        void ask(input.value.trim(), answer, sources);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    host.append(panel);
    input.focus();
  };

  const onMove = (event: Event) => {
    if (!deps.enabled() || panel) return;
    const e = event as PointerEvent;
    if (detector.push(e.clientX, e.clientY, e.timeStamp)) open({ x: e.clientX, y: e.clientY });
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  return {
    open,
    close,
    get isOpen() {
      return panel !== undefined;
    },
    dispose() {
      document.removeEventListener("pointermove", onMove);
      close();
    },
  };
}

/** Anything that reports shakes of the pointer, such as the wasmos compositor's `onShake` (packages/wasmos). */
export interface ShakeSource {
  onShake(listener: (at: { x: number; y: number }) => void): () => void;
}

/** Open the assistant where a compositor-recognised shake happened (pointer over a client surface). */
export function openOnShake(handle: AssistantHandle, source: ShakeSource): () => void {
  return source.onShake(at => handle.open(at));
}
