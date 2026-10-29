// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { webos } from "../os";
import { openGuestTerminal, type GuestSession } from "@aphrody/webos-wasm";
import css from "./terminal.css" with { type: "text" };
import { keyToBytes } from "./terminal-keys";

/*
 * Terminal app. The shell is a real one: an Alpine Linux guest (container2wasm, Bochs x86_64 + Linux) whose stdin is this
 * keyboard and whose output is rendered by Rio VT (`rio-vt` through aphrody-shell-web's `WebTerminal`). Echo, line editing,
 * history and completion are the guest shell's. The guest image (110 MB) is streamed once into OPFS and instantiated from
 * the cache afterwards; the shell needs cross-origin isolation (SharedArrayBuffer), which the Worker provides.
 */

const THEMES = ["surface", "inverse", "primary", "secondary", "tertiary"] as const;
type Theme = (typeof THEMES)[number];
const COLS = 100;
const ROWS = 30;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`webos.term.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`webos.term.${key}`, value);
    } catch {
      // storage disabled: the look resets on reload
    }
  },
};

const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

function statusOf(session: GuestSession): string {
  switch (session.state) {
    case "loading": {
      const { done, total, cached } = session.progress;
      if (!total) return "Starting Alpine Linux…";
      return cached ? "Loading Alpine Linux from this browser…" : `Downloading Alpine Linux ${mb(done)} / ${mb(total)} (once)`;
    }
    case "booting":
      return "Booting Alpine Linux…";
    case "ready":
      return "Alpine Linux";
    case "exited":
      return `The shell ended (exit ${session.exitCode ?? 0}). Press Enter to start a new one.`;
    case "error":
      return session.error ?? "The guest failed to start.";
  }
}

export async function terminalApp(root: HTMLElement) {
  await webos(); // initialises the wasm module that carries WebTerminal
  if (!document.getElementById("tm-css")) document.head.append(h("style", { id: "tm-css" }, css));
  void document.fonts?.load('14px "Google Sans Code"');

  let theme = (store.get("theme") as Theme | null) ?? "surface";
  if (!THEMES.includes(theme)) theme = "surface";
  let size = Number(store.get("size")) || 14;

  const screen = h("pre", { class: "tm-screen", "aria-live": "off" });
  const status = h("div", { class: "tm-status" });
  const sink = h("textarea", {
    class: "tm-sink",
    "aria-label": "Terminal input",
    autocapitalize: "off",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLTextAreaElement;
  const pane = h("div", { class: "tm-pane focus", tabindex: "-1" }, h("div", { class: "tm-view" }, screen), sink);
  const app = h("div", { class: "tm-app", "data-theme": theme }, h("div", { class: "tm-body" }, pane), status);
  app.style.setProperty("--tm-size", `${size}px`);
  root.append(app);

  let session: GuestSession;
  const render = () => {
    const snap = session.snapshot();
    const lines = snap.lines.map(l => l.replace(/\s+$/, ""));
    while (lines.length && !lines.at(-1)) lines.pop();
    screen.replaceChildren();
    const cur = snap.cursor;
    lines.forEach((line, row) => {
      if (row === cur.row && cur.visible) {
        const padded = line.padEnd(cur.col + 1, " ");
        screen.append(padded.slice(0, cur.col), h("span", { class: "tm-cursor" }, padded[cur.col] ?? " "), padded.slice(cur.col + 1));
      } else screen.append(line);
      screen.append("\n");
    });
    if (cur.visible && cur.row >= lines.length) screen.append(" ".repeat(cur.col), h("span", { class: "tm-cursor" }, " "));
    status.textContent = statusOf(session);
    pane.scrollTop = pane.scrollHeight;
  };
  const start = () => {
    session?.dispose();
    session = openGuestTerminal({ cols: COLS, rows: ROWS, workerUrl: "/guest-worker.js" });
    session.onChange(render);
    render();
  };
  start();

  sink.addEventListener("keydown", e => {
    if (session.state === "exited" && e.key === "Enter") {
      e.preventDefault();
      start();
      return;
    }
    // Ctrl+Shift+C / V and the theme and size shortcuts stay with the app; everything else goes to the guest.
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void navigator.clipboard?.writeText(getSelection()?.toString() || screen.textContent || "");
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") return; // the paste event handles it
    if (e.ctrlKey && (e.key === "+" || e.key === "=" || e.key === "-")) {
      e.preventDefault();
      size = Math.max(10, Math.min(28, size + (e.key === "-" ? -1 : 1)));
      app.style.setProperty("--tm-size", `${size}px`);
      store.set("size", String(size));
      return;
    }
    const bytes = keyToBytes(e);
    if (bytes === undefined) return;
    e.preventDefault();
    session.type(bytes);
  });
  sink.addEventListener("paste", e => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text") ?? "";
    if (text) session.type(text.replace(/\r?\n/g, "\r"));
  });
  pane.addEventListener("pointerdown", () => queueMicrotask(() => sink.focus()));
  sink.focus();

  // Closing the window stops the guest.
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      session.dispose();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
