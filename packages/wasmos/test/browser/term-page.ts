// The page side of the interactive terminal: guest output -> Rio VT (WebTerminal from aphrody-shell-web, wasm-bindgen
// `web` target), keystrokes -> the guest's stdin ring. `window.__term` is what the test drives.
import { StdinRing } from "../../src/interactive.ts";

declare global {
  interface Window {
    __term: {
      type(text: string): void;
      screen(): string;
      started: boolean;
      exited: number | undefined;
      error: string | undefined;
    };
  }
}

const base = new URL(".", import.meta.url).href;
const rio = await import("/rio/aphrody_shell_web.js");
await rio.default("/rio/aphrody_shell_web_bg.wasm");
const vt = new rio.WebTerminal(100, 30);
const ring = new StdinRing();
const state: Window["__term"] = {
  type: text => ring.write(new TextEncoder().encode(text)),
  screen: () => vt.scrape_text(),
  started: false,
  exited: undefined,
  error: undefined,
};
window.__term = state;

const worker = new Worker("/guest-worker.js", { type: "module" });
worker.onmessage = e => {
  const m = e.data as { out?: Uint8Array; err?: Uint8Array; started?: boolean; exit?: number; error?: string };
  if (m.out) vt.ingest(m.out);
  if (m.err) vt.ingest(m.err);
  if (m.started) state.started = true;
  if (m.exit !== undefined) state.exited = m.exit;
  if (m.error) state.error = m.error;
  for (const reply of vt.take_replies()) state.type(reply); // CPR/DSR answers go back to the guest
};
const args = JSON.parse(new URLSearchParams(location.search).get("args") ?? '["sh"]');
worker.postMessage({ wasm: "/alpine.wasm", args, stdin: ring.buffer });
void base;
