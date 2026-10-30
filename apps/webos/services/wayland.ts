// SPDX-License-Identifier: Apache-2.0
// Gateway of the real Hyprland session (aphrody-hyprland.service) for the WebOS thin client.
// Loopback only (127.0.0.1:8793), behind nginx /api/wayland/. Auth: bearer token (Authorization header, or the
// WebSocket subprotocol "bearer.<token>") compared to WAYLAND_TOKEN. Frames: wf-recorder MJPEG (damage driven);
// input and clipboard: RFB to the loopback wayvnc of the same session (wlr-virtual-pointer/keyboard).
import { readdirSync, statSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

const RUNTIME = Bun.env.WAYLAND_XDG_RUNTIME_DIR ?? "/run/user/1000/ah";
const VNC_PORT = Number(Bun.env.WAYLAND_VNC_PORT ?? 5901);
const OUTPUT = Bun.env.WAYLAND_OUTPUT ?? "HEADLESS-1";
const TOKEN = Bun.env.WAYLAND_TOKEN ?? "";
const MAX_STREAMS = 6;

/** app id -> argv, resolved here and never by the client. */
export const LAUNCHERS: Record<string, string[]> = {
  rio: ["rio"],
  foot: ["foot"],
  "cosmic-files": ["cosmic-files"],
  "cosmic-term": ["cosmic-term"],
  "cosmic-edit": ["cosmic-edit"],
  "cosmic-store": ["cosmic-store"],
  "cosmic-settings": ["cosmic-settings"],
  "cosmic-player": ["cosmic-player"],
  "cosmic-calculator": ["cosmic-calculator"],
  spacedrive: ["spacedrive"],
};

function sessionEnv(): Record<string, string> {
  let sig = "";
  try {
    sig =
      readdirSync(`${RUNTIME}/hypr`)
        .map((n) => ({ n, t: statSync(`${RUNTIME}/hypr/${n}`).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]?.n ?? "";
  } catch {}
  return {
    ...(process.env as Record<string, string>),
    XDG_RUNTIME_DIR: RUNTIME,
    WAYLAND_DISPLAY: "wayland-1",
    HYPRLAND_INSTANCE_SIGNATURE: sig,
    XDG_SESSION_TYPE: "wayland",
    XDG_CURRENT_DESKTOP: "Hyprland",
  };
}

async function run(argv: string[]): Promise<string> {
  const p = Bun.spawn(argv, { env: sessionEnv(), stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out;
}
const hypr = (...a: string[]) => run(["hyprctl", ...a]);
const hyprJson = async (...a: string[]) => JSON.parse(await hypr(...a, "-j"));

interface Client {
  address: string;
  class: string;
  title: string;
  at: [number, number];
  size: [number, number];
  workspace: { id: number };
  pid: number;
  mapped: boolean;
}
const clients = async (): Promise<Client[]> => (await hyprJson("clients")).filter((c: Client) => c.mapped);

function protoToken(request: Request): string | undefined {
  return request.headers
    .get("sec-websocket-protocol")
    ?.split(",")
    .map((s) => s.trim())
    .find((s) => s.startsWith("bearer."));
}
function authorized(request: Request): boolean {
  if (!TOKEN) return false;
  const header = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  const given = Buffer.from(header ?? protoToken(request)?.slice(7) ?? "");
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store" } });

// ---- RFB input channel (wayvnc, loopback, no auth) ----
type Sock = Awaited<ReturnType<typeof Bun.connect>>;
class Rfb {
  private sock?: Sock;
  private buf = Buffer.alloc(0);
  private stage = 0;
  ready: Promise<void>;
  onClipboard: (text: string) => void = () => {};
  width = 0;
  height = 0;
  constructor() {
    let ok!: () => void, bad!: (e: unknown) => void;
    this.ready = new Promise((a, b) => {
      ok = a;
      bad = b;
    });
    Bun.connect({
      hostname: "127.0.0.1",
      port: VNC_PORT,
      socket: {
        open: (s) => {
          this.sock = s;
        },
        data: (s, d) => {
          this.buf = Buffer.concat([this.buf, d]);
          this.pump(s, ok);
        },
        error: (_s, e) => bad(e),
        close: () => bad(new Error("vnc closed")),
      },
    }).catch(bad);
  }
  private pump(s: Sock, ok: () => void) {
    for (;;) {
      if (this.stage === 0) {
        if (this.buf.length < 12) return;
        this.buf = this.buf.subarray(12);
        s.write("RFB 003.008\n");
        this.stage = 1;
      } else if (this.stage === 1) {
        if (this.buf.length < 1) return;
        const n = this.buf[0];
        if (this.buf.length < 1 + n) return;
        const types = [...this.buf.subarray(1, 1 + n)];
        this.buf = this.buf.subarray(1 + n);
        if (!types.includes(1)) throw new Error("wayvnc requires auth");
        s.write(Uint8Array.of(1));
        this.stage = 2;
      } else if (this.stage === 2) {
        if (this.buf.length < 4) return;
        this.buf = this.buf.subarray(4);
        s.write(Uint8Array.of(1));
        this.stage = 3;
      } else if (this.stage === 3) {
        if (this.buf.length < 24) return;
        this.width = this.buf.readUInt16BE(0);
        this.height = this.buf.readUInt16BE(2);
        const nl = this.buf.readUInt32BE(20);
        if (this.buf.length < 24 + nl) return;
        this.buf = this.buf.subarray(24 + nl);
        this.stage = 4;
        ok();
      } else {
        if (this.buf.length < 1) return;
        const t = this.buf[0];
        if (t === 3) {
          if (this.buf.length < 8) return;
          const len = this.buf.readUInt32BE(4);
          if (this.buf.length < 8 + len) return;
          this.onClipboard(this.buf.subarray(8, 8 + len).toString("latin1"));
          this.buf = this.buf.subarray(8 + len);
        } else if (t === 2) this.buf = this.buf.subarray(1);
        else {
          this.buf = Buffer.alloc(0); // framebuffer updates are never requested
          return;
        }
      }
    }
  }
  pointer(x: number, y: number, mask: number) {
    const b = Buffer.alloc(6);
    b[0] = 5;
    b[1] = mask;
    b.writeUInt16BE(Math.max(0, Math.round(x)), 2);
    b.writeUInt16BE(Math.max(0, Math.round(y)), 4);
    this.sock?.write(b);
  }
  key(down: boolean, keysym: number) {
    const b = Buffer.alloc(8);
    b[0] = 4;
    b[1] = down ? 1 : 0;
    b.writeUInt32BE(keysym >>> 0, 4);
    this.sock?.write(b);
  }
  cut(text: string) {
    const t = Buffer.from(text, "latin1");
    const b = Buffer.alloc(8 + t.length);
    b[0] = 6;
    b.writeUInt32BE(t.length, 4);
    t.copy(b, 8);
    this.sock?.write(b);
  }
  close() {
    this.sock?.end();
  }
}

// ---- frame source: wf-recorder MJPEG over a pipe, parsed from the mpjpeg multipart ----
let streams = 0;
function frames(geometry: string | null, fps: number, onFrame: (jpeg: Uint8Array) => void) {
  const argv = [
    "wf-recorder", "-o", OUTPUT, "-c", "mjpeg", "-x", "yuvj420p", "-m", "mpjpeg",
    "-r", String(fps), "-f", "/dev/stdout", ...(geometry ? ["-g", geometry] : []),
  ];
  const p = Bun.spawn(argv, { env: sessionEnv(), stdout: "pipe", stderr: "ignore" });
  let buf = Buffer.alloc(0);
  void (async () => {
    for await (const chunk of p.stdout) {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const m = buf.indexOf("Content-length: ");
        if (m < 0) {
          if (buf.length > 1 << 20) buf = Buffer.alloc(0);
          break;
        }
        const eol = buf.indexOf("\r\n\r\n", m);
        if (eol < 0) break;
        const len = Number(buf.subarray(m + 16, buf.indexOf("\r\n", m)).toString());
        if (buf.length < eol + 4 + len) break;
        onFrame(new Uint8Array(buf.subarray(eol + 4, eol + 4 + len)));
        buf = buf.subarray(eol + 4 + len);
      }
    }
  })();
  return p;
}

interface Ctx {
  win: string;
  rfb: Rfb;
  proc?: ReturnType<typeof Bun.spawn>;
  origin: [number, number];
  fps: number;
}

async function geometryOf(win: string): Promise<{ geo: string | null; origin: [number, number] }> {
  if (win === "root") return { geo: null, origin: [0, 0] };
  const c = (await clients()).find((x) => x.address === win);
  if (!c) throw new Error("no such window");
  return { geo: `${c.at[0]},${c.at[1]} ${c.size[0]}x${c.size[1]}`, origin: c.at };
}
const clamp = (n: number | undefined, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.trunc(n ?? d)));
const setMonitor = (w?: number, h?: number) =>
  hypr("keyword", "monitor", `${OUTPUT},${clamp(w, 640, 3840, 1600)}x${clamp(h, 480, 2160, 900)}@60,0x0,1`);

const server = Bun.serve<Ctx>({
  hostname: "127.0.0.1",
  port: Number(Bun.env.PORT ?? 8793),
  async fetch(request, srv) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/(wayland|hyprland|session)/, "") || "/";
    if (path === "/health") return json({ ok: true, session: sessionEnv().HYPRLAND_INSTANCE_SIGNATURE !== "" });
    if (!authorized(request)) return json({ error: "unauthorized" }, 401);
    try {
      if (path === "/status") {
        const [version, monitors, workspaces] = await Promise.all([hyprJson("version"), hyprJson("monitors"), hyprJson("workspaces")]);
        const launchers = Object.fromEntries(Object.entries(LAUNCHERS).map(([k, v]) => [k, !!Bun.which(v[0])]));
        return json({ version: version.tag, monitors, workspaces, streams, launchers });
      }
      if (path === "/clients") return json(await clients());
      const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
      if (path === "/launch" && request.method === "POST") {
        const app = String(body.app);
        const argv = LAUNCHERS[app];
        if (!argv) return json({ error: "unknown-app" }, 404);
        if (!Bun.which(argv[0])) return json({ error: "not-installed", app }, 404);
        const args = Array.isArray(body.args) ? body.args.map(String).filter((a) => /^[\w./:=@+-]+$/.test(a)) : [];
        const before = new Set((await clients()).map((c) => c.address));
        await hypr("dispatch", "exec", [...argv, ...args].join(" "));
        for (let i = 0; i < 50; i++) {
          await Bun.sleep(200);
          const fresh = (await clients()).find((c) => !before.has(c.address));
          if (fresh) return json({ address: fresh.address, class: fresh.class, pid: fresh.pid });
        }
        return json({ error: "no-window" }, 504);
      }
      if (path === "/workspace" && request.method === "POST") return json({ out: await hypr("dispatch", "workspace", String(Math.trunc(Number(body.id)))) });
      if (path === "/focus" && request.method === "POST") return json({ out: await hypr("dispatch", "focuswindow", `address:${String(body.address)}`) });
      if (path === "/close" && request.method === "POST") return json({ out: await hypr("dispatch", "closewindow", `address:${String(body.address)}`) });
      if (path === "/resize" && request.method === "POST") return json({ out: await setMonitor(Number(body.width), Number(body.height)) });
      if (path === "/stream") {
        if (streams >= MAX_STREAMS) return json({ error: "busy" }, 503);
        const win = url.searchParams.get("window") ?? "root";
        const fps = clamp(Number(url.searchParams.get("fps")), 1, 60, 30);
        await geometryOf(win);
        const rfb = new Rfb();
        await rfb.ready;
        const proto = protoToken(request);
        const ok = srv.upgrade(request, { data: { win, rfb, origin: [0, 0], fps } as Ctx, headers: proto ? { "sec-websocket-protocol": proto } : undefined });
        if (!ok) {
          rfb.close();
          return json({ error: "upgrade" }, 426);
        }
        return undefined as unknown as Response;
      }
      return json({ error: "not-found" }, 404);
    } catch (e) {
      return json({ error: String((e as Error).message ?? e) }, 500);
    }
  },
  websocket: {
    idleTimeout: 120,
    async open(ws) {
      const c = ws.data;
      streams++;
      const { geo, origin } = await geometryOf(c.win).catch(() => ({ geo: null, origin: [0, 0] as [number, number] }));
      c.origin = origin;
      c.proc = frames(geo, c.fps, (f) => {
        if (ws.getBufferedAmount() < 2_000_000) ws.sendBinary(f);
      });
      c.rfb.onClipboard = (text) => ws.send(JSON.stringify({ t: "clipboard", text }));
      ws.send(JSON.stringify({ t: "hello", window: c.win, origin, width: c.rfb.width, height: c.rfb.height }));
    },
    message(ws, raw) {
      if (typeof raw !== "string") return;
      const c = ws.data;
      let m: { t: string; x?: number; y?: number; mask?: number; down?: boolean; keysym?: number; text?: string; id?: number; width?: number; height?: number };
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.t === "pointer") c.rfb.pointer((m.x ?? 0) + c.origin[0], (m.y ?? 0) + c.origin[1], m.mask ?? 0);
      else if (m.t === "key" && typeof m.keysym === "number") c.rfb.key(!!m.down, m.keysym);
      else if (m.t === "clipboard" && typeof m.text === "string") c.rfb.cut(m.text.slice(0, 1 << 20));
      else if (m.t === "workspace" && typeof m.id === "number") void hypr("dispatch", "workspace", String(Math.trunc(m.id)));
      else if (m.t === "resize" && c.win === "root") void setMonitor(m.width, m.height);
    },
    close(ws) {
      streams--;
      ws.data.proc?.kill();
      ws.data.rfb.close();
    },
  },
});
console.log(`wayland gateway: ${server.url}`);
