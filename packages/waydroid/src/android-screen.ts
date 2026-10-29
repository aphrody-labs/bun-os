// SPDX-License-Identifier: MIT
import { avcCodecString } from "./scrcpy.ts";

/**
 * <android-screen src="ws://host/stream?token=..." api="http://host" serial="emulator-5554">
 * Shows the Android display streamed by the gateway (H.264 through WebCodecs) and sends touch, keyboard,
 * clipboard and APK drops back. Colors come from the Material 3 system tokens of @aphrody/themes
 * (--md-sys-color-*), with neutral fallbacks.
 */

/** Android KeyEvent keycodes for the keys that have no printable text. */
export const ANDROID_KEYS: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
};

export interface FrameStats {
  frames: number;
  bytes: number;
  decoded: number;
  /** Frames per second over the last second. */
  fps: number;
  /** Milliseconds between the last input event and the next decoded frame. */
  inputToFrameMs: number | undefined;
}

const STYLE = `
:host { display: inline-block; position: relative; background: var(--md-sys-color-surface-container, #1d1b20);
  border-radius: var(--md-sys-shape-corner-large, 16px); overflow: hidden; outline: none; touch-action: none; }
canvas { display: block; width: 100%; height: 100%; object-fit: contain; }
.status { position: absolute; inset: auto 8px 8px 8px; font: 12px/1.4 var(--md-sys-typescale-body-small-font, system-ui);
  color: var(--md-sys-color-on-surface-variant, #cac4d0); pointer-events: none; }
:host(.drop) { box-shadow: inset 0 0 0 3px var(--md-sys-color-primary, #d0bcff); }
`;

export class AndroidScreen extends HTMLElement {
  static observedAttributes = ["src"];
  #canvas = document.createElement("canvas");
  #status = document.createElement("div");
  #ws?: WebSocket;
  #decoder?: VideoDecoder;
  #ctx = this.#canvas.getContext("2d")!;
  #width = 0;
  #height = 0;
  #configured = false;
  #needKey = true;
  #lastInput = 0;
  #recent: number[] = [];
  stats: FrameStats = { frames: 0, bytes: 0, decoded: 0, fps: 0, inputToFrameMs: undefined };

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.#status.className = "status";
    root.append(style, this.#canvas, this.#status);
    this.tabIndex = 0;
  }

  connectedCallback(): void {
    this.#bindInput();
    if (this.getAttribute("src")) this.connect();
  }

  disconnectedCallback(): void {
    this.disconnect();
  }

  attributeChangedCallback(name: string): void {
    if (name === "src" && this.isConnected) this.connect();
  }

  connect(): void {
    this.disconnect();
    const src = this.getAttribute("src");
    if (!src) return;
    if (typeof VideoDecoder === "undefined") {
      this.#setStatus("WebCodecs VideoDecoder is not available in this browser");
      return;
    }
    this.#setStatus("connecting");
    const ws = new WebSocket(src);
    ws.binaryType = "arraybuffer";
    this.#ws = ws;
    ws.onmessage = e => (typeof e.data === "string" ? this.#onText(e.data) : this.#onFrame(new Uint8Array(e.data)));
    ws.onclose = e => this.#setStatus(e.reason ? `closed: ${e.reason}` : "closed");
  }

  disconnect(): void {
    this.#ws?.close();
    this.#ws = undefined;
    if (this.#decoder && this.#decoder.state !== "closed") this.#decoder.close();
    this.#decoder = undefined;
    this.#configured = false;
    this.#needKey = true;
  }

  #setStatus(text: string): void {
    this.#status.textContent = text;
    this.dispatchEvent(new CustomEvent("android-status", { detail: text }));
  }

  #onText(text: string): void {
    const m = JSON.parse(text) as { type: string; width?: number; height?: number; reason?: string; name?: string };
    if (m.type === "meta" && m.width && m.height) {
      this.#width = m.width;
      this.#height = m.height;
      this.#canvas.width = m.width;
      this.#canvas.height = m.height;
      this.#setStatus(m.name ?? "");
    } else if (m.type === "closed") {
      this.#setStatus(`closed: ${m.reason ?? ""}`);
    }
  }

  #onFrame(wire: Uint8Array): void {
    const flags = wire[0]!;
    const pts = Number(new DataView(wire.buffer, wire.byteOffset).getBigUint64(1));
    const payload = wire.subarray(9);
    this.stats.frames++;
    this.stats.bytes += payload.byteLength;
    if (flags & 1) {
      const codec = avcCodecString(payload);
      if (!codec) return;
      this.#decoder?.close();
      this.#decoder = new VideoDecoder({
        output: f => this.#draw(f),
        error: e => this.#setStatus(`decoder: ${e.message}`),
      });
      this.#decoder.configure({ codec, optimizeForLatency: true });
      this.#configured = true;
      this.#needKey = true;
      // The config packet carries SPS/PPS; the decoder needs them in front of the next key frame.
      this.#pendingConfig = payload.slice();
      return;
    }
    if (!this.#configured || !this.#decoder) return;
    const key = (flags & 2) !== 0;
    if (this.#needKey && !key) return;
    this.#needKey = false;
    const data = key && this.#pendingConfig ? concat(this.#pendingConfig, payload) : payload;
    this.#decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: pts, data }));
  }
  #pendingConfig?: Uint8Array;

  #draw(frame: VideoFrame): void {
    this.#ctx.drawImage(frame, 0, 0, this.#canvas.width, this.#canvas.height);
    frame.close();
    const now = performance.now();
    this.stats.decoded++;
    this.#recent.push(now);
    while (this.#recent.length && now - this.#recent[0]! > 1000) this.#recent.shift();
    this.stats.fps = this.#recent.length;
    if (this.#lastInput) {
      this.stats.inputToFrameMs = now - this.#lastInput;
      this.#lastInput = 0;
    }
    this.dispatchEvent(new CustomEvent("android-frame", { detail: this.stats }));
  }

  #send(msg: object): void {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#lastInput = performance.now();
      this.#ws.send(JSON.stringify(msg));
    }
  }

  #point(e: PointerEvent): { x: number; y: number; w: number; h: number } {
    const r = this.#canvas.getBoundingClientRect();
    // object-fit: contain letterboxes the picture inside the element box.
    const scale = Math.min(r.width / this.#width, r.height / this.#height) || 1;
    const dw = this.#width * scale;
    const dh = this.#height * scale;
    const ox = r.left + (r.width - dw) / 2;
    const oy = r.top + (r.height - dh) / 2;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
    return {
      x: clamp((e.clientX - ox) / scale, this.#width),
      y: clamp((e.clientY - oy) / scale, this.#height),
      w: this.#width,
      h: this.#height,
    };
  }

  #bindInput(): void {
    if (this.#bound) return;
    this.#bound = true;
    const touch = (action: "down" | "up" | "move") => (e: PointerEvent) => {
      if (!this.#width) return;
      if (action === "down") this.#canvas.setPointerCapture(e.pointerId);
      if (action === "move" && !(e.buttons & 1)) return;
      this.#send({ t: "touch", action, id: e.pointerId, ...this.#point(e) });
      e.preventDefault();
    };
    this.#canvas.addEventListener("pointerdown", touch("down"));
    this.#canvas.addEventListener("pointermove", touch("move"));
    this.#canvas.addEventListener("pointerup", touch("up"));
    this.#canvas.addEventListener("pointercancel", touch("up"));
    this.addEventListener("keydown", e => this.#key(e, "down"));
    this.addEventListener("keyup", e => this.#key(e, "up"));
    this.addEventListener("paste", e => {
      const text = e.clipboardData?.getData("text/plain");
      if (text) this.#send({ t: "clip", text, paste: true });
      e.preventDefault();
    });
    this.addEventListener("wheel", e => {
      const r = this.#canvas.getBoundingClientRect();
      this.#send({
        t: "scroll",
        x: ((e.clientX - r.left) / r.width) * this.#width,
        y: ((e.clientY - r.top) / r.height) * this.#height,
        w: this.#width,
        h: this.#height,
        dx: -e.deltaX / 100,
        dy: -e.deltaY / 100,
      });
      e.preventDefault();
    }, { passive: false });
    this.addEventListener("dragover", e => {
      e.preventDefault();
      this.classList.add("drop");
    });
    this.addEventListener("dragleave", () => this.classList.remove("drop"));
    this.addEventListener("drop", e => {
      e.preventDefault();
      this.classList.remove("drop");
      const file = [...(e.dataTransfer?.files ?? [])].find(f => f.name.endsWith(".apk"));
      if (file) void this.installApk(file);
    });
  }
  #bound = false;

  #key(e: KeyboardEvent, action: "down" | "up"): void {
    if (e.ctrlKey || e.metaKey) return; // leave shortcuts such as paste to the browser
    const code = ANDROID_KEYS[e.key];
    if (code !== undefined) {
      this.#send({ t: "key", action, code });
      e.preventDefault();
    } else if (action === "down" && e.key.length === 1) {
      this.#send({ t: "text", text: e.key });
      e.preventDefault();
    }
  }

  /** POST the APK to the gateway; resolves with its `adb install` output. */
  async installApk(file: Blob & { name?: string }): Promise<{ ok: boolean; output: string }> {
    const api = this.getAttribute("api") ?? new URL(this.getAttribute("src") ?? location.href, location.href).origin.replace(/^ws/, "http");
    const serial = this.getAttribute("serial");
    const token = this.getAttribute("token");
    const q = new URLSearchParams({ name: file.name ?? "upload.apk" });
    if (serial) q.set("serial", serial);
    const res = await fetch(`${api}/api/install?${q}`, {
      method: "POST",
      body: file,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const out = (await res.json()) as { ok: boolean; output: string };
    this.dispatchEvent(new CustomEvent("android-install", { detail: out }));
    return out;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

if (typeof customElements !== "undefined" && !customElements.get("android-screen")) {
  customElements.define("android-screen", AndroidScreen);
}
