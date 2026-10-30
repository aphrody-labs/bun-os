// SPDX-License-Identifier: Apache-2.0
// Thin client of the real Hyprland session: draws the MJPEG stream of the whole desktop (window "root") or of one
// Wayland toplevel (its Hyprland address) on a canvas, and sends pointer, keyboard, clipboard, workspace and resize
// input back over the same WebSocket. Gateway: apps/webos/services/wayland.ts at /api/wayland/*.

export interface HyprlandOptions {
  /** Hyprland client address (from POST /api/wayland/launch or GET /clients); omit for the whole desktop. */
  window?: string;
  /** Bearer token of the gateway; defaults to localStorage "aphrody.wayland.token". */
  token?: string;
  /** API base, default same origin "/api/wayland". */
  base?: string;
  fps?: number;
  /** Desktop only: resize the compositor output to the element size. */
  resizeToFit?: boolean;
}
export interface HyprlandView {
  close(): void;
  workspace(id: number): void;
  /** Frames per second received over the last second, and last input-to-frame latency estimate in ms. */
  stats(): { fps: number; latencyMs: number };
}

const SPECIAL: Record<string, number> = {
  Backspace: 0xff08, Tab: 0xff09, Enter: 0xff0d, Escape: 0xff1b, Delete: 0xffff, Home: 0xff50, ArrowLeft: 0xff51,
  ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54, PageUp: 0xff55, PageDown: 0xff56, End: 0xff57,
  Insert: 0xff63, Shift: 0xffe1, Control: 0xffe3, Alt: 0xffe9, Meta: 0xffeb, CapsLock: 0xffe5, ContextMenu: 0xff67,
};
function keysym(e: KeyboardEvent): number | undefined {
  const k = e.key;
  if (k.length > 1) {
    if (/^F([1-9]|1[0-2])$/.test(k)) return 0xffbd + Number(k.slice(1));
    const s = SPECIAL[k];
    return s === undefined ? undefined : e.location === 2 && s >= 0xffe1 && s <= 0xffeb ? s + 1 : s;
  }
  const cp = k.codePointAt(0)!;
  return cp < 0x100 ? cp : 0x01000000 + cp;
}

export function mountHyprland(el: HTMLElement, opts: HyprlandOptions = {}): HyprlandView {
  const win = opts.window ?? "root";
  const base = opts.base ?? "/api/wayland";
  const token = opts.token ?? localStorage.getItem("aphrody.wayland.token") ?? "";
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.style.cssText = "width:100%;height:100%;display:block;outline:none;object-fit:contain;background:#000;touch-action:none";
  el.replaceChildren(canvas);
  const ctx = canvas.getContext("2d")!;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams({ window: win, fps: String(opts.fps ?? 30) });
  let ws: WebSocket | undefined;
  let closed = false;
  let frames = 0, fps = 0, lastInput = 0, latency = 0;
  const tick = setInterval(() => ((fps = frames), (frames = 0)), 1000);
  let mask = 0;
  const send = (m: object) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  const connect = () => {
    ws = new WebSocket(`${proto}//${location.host}${base}/stream?${q}`, [`bearer.${token}`]);
    ws.binaryType = "blob";
    ws.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        const m = JSON.parse(ev.data) as { t: string; text?: string };
        if (m.t === "clipboard" && m.text) void navigator.clipboard?.writeText(m.text).catch(() => {});
        return;
      }
      const bmp = await createImageBitmap(ev.data as Blob);
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
        canvas.width = bmp.width;
        canvas.height = bmp.height;
      }
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      frames++;
      if (lastInput) {
        latency = performance.now() - lastInput;
        lastInput = 0;
      }
    };
    ws.onopen = () => {
      if (win === "root" && opts.resizeToFit) fit();
    };
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 1500);
    };
  };

  const pos = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };
  const ptr = (e: PointerEvent, extra = 0) => {
    lastInput = performance.now();
    send({ t: "pointer", ...pos(e), mask: mask | extra });
  };
  canvas.addEventListener("pointermove", (e) => ptr(e));
  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    mask |= 1 << (e.button === 0 ? 0 : e.button === 1 ? 1 : 2);
    ptr(e);
  });
  canvas.addEventListener("pointerup", (e) => {
    mask &= ~(1 << (e.button === 0 ? 0 : e.button === 1 ? 1 : 2));
    ptr(e);
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const bit = e.deltaY < 0 ? 8 : e.deltaY > 0 ? 16 : e.deltaX < 0 ? 32 : 64;
    const p = pos(e as unknown as PointerEvent);
    send({ t: "pointer", ...p, mask: mask | bit });
    send({ t: "pointer", ...p, mask });
  }, { passive: false });
  const key = (down: boolean) => (e: KeyboardEvent) => {
    const s = keysym(e);
    if (s === undefined) return;
    e.preventDefault();
    lastInput = performance.now();
    send({ t: "key", down, keysym: s });
  };
  canvas.addEventListener("keydown", key(true));
  canvas.addEventListener("keyup", key(false));
  canvas.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text) send({ t: "clipboard", text });
  });

  const fit = () => send({ t: "resize", width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) });
  const ro = opts.resizeToFit && win === "root" ? new ResizeObserver(() => fit()) : undefined;
  ro?.observe(el);
  connect();

  return {
    close() {
      closed = true;
      clearInterval(tick);
      ro?.disconnect();
      ws?.close();
    },
    workspace: (id) => send({ t: "workspace", id }),
    stats: () => ({ fps, latencyMs: Math.round(latency) }),
  };
}
