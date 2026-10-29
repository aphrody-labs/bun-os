// SPDX-License-Identifier: Apache-2.0
// A real shell for the WebOS terminals: an Alpine Linux guest (see guest-worker.ts) whose output is rendered by Rio VT
// (`WebTerminal` of aphrody-shell-web) and whose keyboard is the stdin of the guest. Replaces the old in-process shell.
import { StdinRing } from "../../wasmos/src/interactive.ts";
import type { GuestMessage, GuestStart } from "./guest-worker.ts";

export interface Snapshot {
  columns: number;
  rows: number;
  lines: string[];
  cursor: { row: number; col: number; visible: boolean };
}

/** The part of `WebTerminal` the session uses. */
export interface RioVt {
  ingest(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  snapshot_json(): string;
  take_replies(): string[];
}

export type GuestState = "loading" | "booting" | "ready" | "exited" | "error";

export interface GuestOptions {
  vt: RioVt;
  /** Guest image URL (the Worker serves it from R2); default `/vm/alpine-x86_64.wasm`. */
  wasm?: string;
  /** URL of the bundled guest-worker.ts; default `/guest-worker.js`. */
  workerUrl?: string | URL;
  /** Command of the guest; default an interactive shell. */
  args?: string[];
  /** Create the worker (tests and hosts with their own loader). */
  spawn?: (url: string | URL) => Worker;
}

/** Marker the BusyBox prompt ends with once the guest shell waits for input. */
const PROMPT = /[#$] $/;

export class GuestSession {
  readonly ring = new StdinRing();
  private readonly worker: Worker;
  private readonly listeners = new Set<() => void>();
  state: GuestState = "loading";
  error?: string;
  /** Download or cache progress of the image (bytes). */
  progress = { done: 0, total: 0, cached: false };
  exitCode?: number;

  constructor(private readonly o: GuestOptions) {
    this.worker = (o.spawn ?? (url => new Worker(url, { type: "module" })))(o.workerUrl ?? "/guest-worker.js");
    this.worker.onmessage = (e: MessageEvent<GuestMessage>) => this.onMessage(e.data);
    this.worker.onerror = e => this.fail(e.message);
    const start: GuestStart = {
      wasm: o.wasm ?? "/vm/alpine-x86_64.wasm",
      args: o.args ?? ["sh"],
      stdin: this.ring.buffer,
    };
    this.worker.postMessage(start);
  }

  private onMessage(m: GuestMessage) {
    if ("out" in m || "err" in m) {
      const bytes = "out" in m ? m.out : m.err;
      this.o.vt.ingest(bytes);
      for (const reply of this.o.vt.take_replies()) this.write(reply); // CPR/DSR answers go back to the guest
      if (
        this.state === "booting" &&
        PROMPT.test(
          this.snapshot()
            .lines.filter(l => l.trim())
            .at(-1) ?? "",
        )
      )
        this.set("ready");
    } else if ("progress" in m) {
      this.progress = m.progress;
      this.set("loading");
    } else if ("started" in m) this.set("booting");
    else if ("exit" in m) {
      this.exitCode = m.exit;
      this.set("exited");
    } else if ("error" in m) this.fail(m.error);
    this.emit();
  }

  private set(state: GuestState) {
    this.state = state;
  }

  private fail(message: string) {
    this.error = message;
    this.state = "error";
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Called after every change of the screen or the session state. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private write(text: string) {
    this.ring.write(new TextEncoder().encode(text));
  }

  /** Type text or bytes into the guest's stdin. */
  type(data: string | Uint8Array): Snapshot {
    this.ring.write(typeof data === "string" ? new TextEncoder().encode(data) : data);
    return this.snapshot();
  }

  snapshot(): Snapshot {
    return JSON.parse(this.o.vt.snapshot_json()) as Snapshot;
  }

  resize(cols: number, rows: number) {
    this.o.vt.resize(cols, rows);
    this.emit();
  }

  get exited(): boolean {
    return this.state === "exited" || this.state === "error";
  }

  dispose() {
    this.worker.terminate();
    this.listeners.clear();
  }
}
