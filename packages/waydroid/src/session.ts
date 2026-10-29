// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { Adb } from "./adb.ts";
import {
  ByteQueue,
  CTRL,
  type CodecName,
  SCRCPY_SERVER_SHA256,
  SCRCPY_SERVER_URL,
  SCRCPY_VERSION,
  type StreamHeader,
  type VideoPacket,
  encodeEmpty,
  readStreamHeader,
  readVideoPacket,
  serverArgs,
  socketName,
} from "./scrcpy.ts";

export interface Conn {
  queue: ByteQueue;
  write(bytes: Uint8Array): void;
  close(): void;
}

export async function connectTcp(port: number, host = "127.0.0.1"): Promise<Conn> {
  const queue = new ByteQueue();
  const sock = await Bun.connect({
    hostname: host,
    port,
    socket: {
      data(_s, d) {
        queue.push(new Uint8Array(d));
      },
      close() {
        queue.end();
      },
      error() {
        queue.end();
      },
      connectError() {
        queue.end();
      },
    },
  });
  return {
    queue,
    write: b => void sock.write(b),
    close: () => sock.end(),
  };
}

export interface SessionMeta extends StreamHeader {
  width: number;
  height: number;
}

export interface Sink {
  meta(m: SessionMeta): void;
  packet(p: Extract<VideoPacket, { kind: "media" }>): void;
  closed(reason: string): void;
}

/**
 * One video + control connection to a scrcpy server, shared by every browser client.
 * `open` supplies the two sockets: video first (it receives the dummy byte and device name), then control.
 */
export class ScrcpySession {
  meta?: SessionMeta;
  #sinks = new Set<Sink>();
  #control?: Conn;
  #video?: Conn;
  #closed = false;
  #config?: Extract<VideoPacket, { kind: "media" }>;
  /** Wall-clock ms of the last media packet, for health checks. */
  lastPacketAt = 0;
  packets = 0;
  bytes = 0;

  private constructor(private readonly onClose: () => void) {}

  static async start(
    open: () => Promise<{ video: Conn; control?: Conn }>,
    onClose: () => void = () => {},
  ): Promise<ScrcpySession> {
    const s = new ScrcpySession(onClose);
    const { video, control } = await open();
    s.#video = video;
    s.#control = control;
    const header = await readStreamHeader(video.queue, { dummyByte: true });
    // The control socket is opened right after the video one; its dummy byte only exists on the first socket.
    const first = await readVideoPacket(video.queue);
    if (first.kind !== "session") throw new Error("expected a session packet after the codec id");
    s.meta = { ...header, width: first.width, height: first.height };
    void s.#pump(video.queue);
    return s;
  }

  async #pump(q: ByteQueue): Promise<void> {
    try {
      for (;;) {
        const p = await readVideoPacket(q);
        if (p.kind === "session") {
          if (this.meta) this.meta = { ...this.meta, width: p.width, height: p.height };
          for (const s of this.#sinks) this.meta && s.meta(this.meta);
          continue;
        }
        if (p.config) this.#config = p;
        this.packets++;
        this.bytes += p.data.byteLength;
        this.lastPacketAt = Date.now();
        for (const s of this.#sinks) s.packet(p);
      }
    } catch (e) {
      this.close(e instanceof Error ? e.message : String(e));
    }
  }

  /** Attach a client. It receives the stream header, then the cached config and a fresh key frame. */
  subscribe(sink: Sink): () => void {
    this.#sinks.add(sink);
    if (this.meta) sink.meta(this.meta);
    if (this.#config) sink.packet(this.#config);
    this.send(encodeEmpty(CTRL.resetVideo));
    return () => void this.#sinks.delete(sink);
  }

  send(message: Uint8Array): void {
    if (!this.#closed) this.#control?.write(message);
  }

  get clients(): number {
    return this.#sinks.size;
  }

  close(reason = "closed"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#video?.close();
    this.#control?.close();
    for (const s of this.#sinks) s.closed(reason);
    this.#sinks.clear();
    this.onClose();
  }
}

export async function ensureServerJar(path: string): Promise<string> {
  const file = Bun.file(path);
  if (await file.exists()) {
    const sum = createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex");
    if (sum === SCRCPY_SERVER_SHA256) return path;
  }
  const res = await fetch(SCRCPY_SERVER_URL);
  if (!res.ok) throw new Error(`scrcpy-server download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== SCRCPY_SERVER_SHA256) throw new Error(`scrcpy-server sha256 mismatch: ${sum}`);
  await Bun.write(path, bytes);
  return path;
}

export interface StartOptions {
  codec?: CodecName;
  maxSize?: number;
  maxFps?: number;
  bitRate?: number;
  jarPath?: string;
}

/** Push the pinned server, start it through `adb shell` and connect video + control through an adb forward. */
export async function startOnDevice(adb: Adb, opts: StartOptions = {}): Promise<ScrcpySession> {
  const jar = await ensureServerJar(opts.jarPath ?? `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/scrcpy-server-v${SCRCPY_VERSION}.jar`);
  const remoteJar = "/data/local/tmp/scrcpy-server.jar";
  await adb.push(jar, remoteJar);
  const scid = Math.floor(Math.random() * 0x7fff_ffff);
  const args = serverArgs({ scid, ...opts });
  const server = Bun.spawn(
    [adb.bin, ...(adb.serial ? ["-s", adb.serial] : []), "shell", `CLASSPATH=${remoteJar}`, "app_process", "/", "com.genymobile.scrcpy.Server", SCRCPY_VERSION, ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  const port = await adb.forward(`localabstract:${socketName(scid)}`);
  // The server listens only after it has started; retry the first connection until it accepts and sends the dummy byte.
  let video: Conn | undefined;
  for (let i = 0; i < 100 && !video; i++) {
    const c = await connectTcp(port).catch(() => undefined);
    if (!c) {
      await Bun.sleep(100);
      continue;
    }
    // adb forward accepts immediately; a dead remote shows up as a closed socket before any byte.
    const ok = await Promise.race([c.queue.peek(1).then(() => true, () => false), Bun.sleep(1500).then(() => false)]);
    if (ok) {
      video = c;
    } else {
      c.close();
      await Bun.sleep(100);
    }
  }
  if (!video) {
    server.kill();
    throw new Error("scrcpy server did not accept a connection");
  }
  const control = await connectTcp(port);
  const session = await ScrcpySession.start(
    async () => ({ video, control }),
    () => {
      server.kill();
      void adb.forwardRemove(port);
    },
  );
  return session;
}
