// SPDX-License-Identifier: MIT
import { timingSafeEqual } from "node:crypto";
import { Adb, type AdbDevice } from "./adb.ts";
import { ScrcpySession, type Sink, type StartOptions, startOnDevice } from "./session.ts";
import {
  ACTION,
  CTRL,
  KEY_ACTION,
  encodeEmpty,
  encodeKeycode,
  encodeScroll,
  encodeSetClipboard,
  encodeText,
  encodeTouch,
} from "./scrcpy.ts";

export interface GatewayOptions {
  port?: number;
  hostname?: string;
  /** Return true to accept the request. Receives the WS upgrade request too (token in `?token=`). */
  authorize?: (req: Request) => boolean | Promise<boolean>;
  /** Shared secret; ignored when `authorize` is set. Falls back to BUN_WAYDROID_TOKEN. */
  token?: string;
  /** Explicit opt-in for an open gateway (loopback development only). */
  allowAnonymous?: boolean;
  adb?: (serial?: string) => Adb;
  sessionFor?: (serial: string | undefined, adb: Adb) => Promise<ScrcpySession>;
  start?: StartOptions;
  maxApkBytes?: number;
}

const SAFE_REMOTE = /^\/(sdcard|storage\/emulated\/0|data\/local\/tmp)\/[^\0]*$/;

export function safeRemotePath(p: string | null): string | undefined {
  if (!p || p.includes("..") || p.includes("\0") || !SAFE_REMOTE.test(p)) return undefined;
  return p;
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function tokenAuthorizer(token: string): (req: Request) => boolean {
  return req => {
    const header = req.headers.get("authorization");
    const given = header?.startsWith("Bearer ") ? header.slice(7) : new URL(req.url).searchParams.get("token");
    return given !== null && constantTimeEqual(given, token);
  };
}

type WsData = { serial?: string; session?: ScrcpySession; unsubscribe?: () => void; sink?: Sink; sent: number };

export type InputMessage =
  | { t: "touch"; action: "down" | "up" | "move"; x: number; y: number; w: number; h: number; id?: number }
  | { t: "key"; action: "down" | "up"; code: number; meta?: number }
  | { t: "text"; text: string }
  | { t: "clip"; text: string; paste?: boolean }
  | { t: "scroll"; x: number; y: number; w: number; h: number; dx: number; dy: number }
  | { t: "back" | "rotate" | "notifications" | "collapse" };

/** Map a browser input message to the scrcpy control bytes. Returns undefined for malformed input. */
export function inputToControl(m: InputMessage): Uint8Array | undefined {
  const finite = (...n: unknown[]) => n.every(v => typeof v === "number" && Number.isFinite(v));
  switch (m.t) {
    case "touch":
      if (!finite(m.x, m.y, m.w, m.h) || !(m.action in ACTION) || m.w <= 0 || m.h <= 0 || m.w > 65535 || m.h > 65535) return undefined;
      return encodeTouch({
        action: ACTION[m.action],
        x: m.x,
        y: m.y,
        width: m.w,
        height: m.h,
        pointerId: m.id === undefined ? undefined : BigInt(Math.max(0, Math.trunc(m.id))),
      });
    case "key":
      if (!finite(m.code) || !(m.action in KEY_ACTION)) return undefined;
      return encodeKeycode(KEY_ACTION[m.action], m.code, 0, m.meta ?? 0);
    case "text":
      return typeof m.text === "string" && m.text.length <= 4096 ? encodeText(m.text) : undefined;
    case "clip":
      return typeof m.text === "string" && m.text.length <= 1 << 20 ? encodeSetClipboard(m.text, !!m.paste) : undefined;
    case "scroll":
      return finite(m.x, m.y, m.w, m.h, m.dx, m.dy) ? encodeScroll({ ...m, width: m.w, height: m.h }) : undefined;
    case "back":
      return encodeEmpty(CTRL.backOrScreenOn);
    case "rotate":
      return encodeEmpty(CTRL.rotate);
    case "notifications":
      return encodeEmpty(CTRL.expandNotifications);
    case "collapse":
      return encodeEmpty(CTRL.collapsePanels);
    default:
      return undefined;
  }
}

/** WebSocket binary frame: [flags u8: 1=config 2=key][pts u64 BE][annex-b payload]. */
export function frameToWire(p: { config: boolean; key: boolean; pts: bigint; data: Uint8Array }): Uint8Array {
  const out = new Uint8Array(9 + p.data.byteLength);
  out[0] = (p.config ? 1 : 0) | (p.key ? 2 : 0);
  new DataView(out.buffer).setBigUint64(1, p.pts);
  out.set(p.data, 9);
  return out;
}

export function startGateway(options: GatewayOptions = {}) {
  const token = options.token ?? process.env.BUN_WAYDROID_TOKEN;
  const authorize = options.authorize ?? (token ? tokenAuthorizer(token) : options.allowAnonymous ? () => true : undefined);
  if (!authorize) throw new Error("gateway needs `authorize`, `token` (or BUN_WAYDROID_TOKEN) or allowAnonymous: true");
  const adbFor = options.adb ?? ((serial?: string) => new Adb(serial));
  const sessions = new Map<string, Promise<ScrcpySession>>();
  const maxApk = options.maxApkBytes ?? 512 * 1024 * 1024;

  const sessionFor = (serial: string | undefined) => {
    const key = serial ?? "";
    let p = sessions.get(key);
    if (!p) {
      const adb = adbFor(serial);
      p = (options.sessionFor ? options.sessionFor(serial, adb) : startOnDevice(adb, options.start)).then(s => {
        const prevClose = s.close.bind(s);
        s.close = (r?: string) => {
          sessions.delete(key);
          prevClose(r);
        };
        return s;
      });
      p.catch(() => sessions.delete(key));
      sessions.set(key, p);
    }
    return p;
  };

  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

  const server = Bun.serve<WsData>({
    port: options.port ?? 0,
    hostname: options.hostname ?? "127.0.0.1",
    async fetch(req, srv) {
      if (!(await authorize(req))) return new Response("unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
      const url = new URL(req.url);
      const serial = url.searchParams.get("serial") ?? undefined;
      try {
        if (url.pathname === "/stream") {
          return srv.upgrade(req, { data: { serial, sent: 0 } }) ? undefined : new Response("websocket required", { status: 426 });
        }
        if (url.pathname === "/api/health") return json({ ok: true, sessions: sessions.size });
        const adb = adbFor(serial);
        if (url.pathname === "/api/devices" && req.method === "GET") return json((await adb.devices()) satisfies AdbDevice[]);
        if (url.pathname === "/api/screenshot" && req.method === "GET") {
          return new Response((await adb.screenshot()).slice(), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
        }
        if (url.pathname === "/api/install" && req.method === "POST") {
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > maxApk) return json({ error: "apk too large" }, 413);
          const bytes = new Uint8Array(await req.arrayBuffer());
          if (bytes.byteLength > maxApk) return json({ error: "apk too large" }, 413);
          // An APK is a zip: PK\x03\x04
          if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ error: "not an apk (missing zip signature)" }, 400);
          const out = await adb.installBytes(bytes, url.searchParams.get("name") ?? "upload.apk");
          return json({ ok: /Success/i.test(out), output: out });
        }
        if (url.pathname === "/api/launch" && req.method === "POST") {
          const { package: pkg } = (await req.json()) as { package?: string };
          if (!pkg) return json({ error: "package required" }, 400);
          return json({ output: (await adb.launch(pkg)).trim() });
        }
        if (url.pathname === "/api/installed" && req.method === "GET") {
          return json({ installed: await adb.isInstalled(url.searchParams.get("package") ?? "") });
        }
        if (url.pathname === "/api/pull" && req.method === "GET") {
          const remote = safeRemotePath(url.searchParams.get("path"));
          if (!remote) return json({ error: "path must be below /sdcard or /data/local/tmp" }, 400);
          const r = await adb.run(["exec-out", "cat", remote]);
          return r.code === 0 ? new Response(r.stdout.slice()) : json({ error: r.stderr.trim() }, 404);
        }
        if (url.pathname === "/api/push" && req.method === "POST") {
          const remote = safeRemotePath(url.searchParams.get("path"));
          if (!remote) return json({ error: "path must be below /sdcard or /data/local/tmp" }, 400);
          const body = new Uint8Array(await req.arrayBuffer());
          const tmp = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/wd-push-${crypto.randomUUID()}`;
          await Bun.write(tmp, body);
          try {
            await adb.push(tmp, remote);
          } finally {
            await Bun.file(tmp).delete().catch(() => {});
          }
          return json({ ok: true, bytes: body.byteLength });
        }
        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    },
    websocket: {
      async open(ws) {
        try {
          const session = await sessionFor(ws.data.serial);
          const sink: Sink = {
            meta: m => ws.send(JSON.stringify({ type: "meta", codec: m.codec, width: m.width, height: m.height, name: m.deviceName })),
            packet: p => {
              ws.data.sent++;
              ws.sendBinary(frameToWire(p));
            },
            closed: reason => {
              ws.send(JSON.stringify({ type: "closed", reason }));
              ws.close(1011, reason.slice(0, 100));
            },
          };
          ws.data.session = session;
          ws.data.sink = sink;
          ws.data.unsubscribe = session.subscribe(sink);
        } catch (e) {
          ws.close(1011, (e instanceof Error ? e.message : String(e)).slice(0, 100));
        }
      },
      message(ws, raw) {
        if (typeof raw !== "string") return;
        let msg: InputMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        const bytes = inputToControl(msg);
        if (bytes) ws.data.session?.send(bytes);
      },
      close(ws) {
        ws.data.unsubscribe?.();
      },
    },
  });

  return {
    server,
    url: `http://${server.hostname}:${server.port}`,
    sessions,
    async stop() {
      for (const p of sessions.values()) (await p.catch(() => undefined))?.close("gateway stopped");
      await server.stop(true);
    },
  };
}
