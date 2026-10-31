// SPDX-License-Identifier: Apache-2.0
/** Host-agnostic shell session: browser WebSocket or the in-WASM local shell. */

const noop = (): void => {};

export interface WasmApi {
  WebTerminal: new (
    cols: number,
    rows: number,
  ) => {
    ingest(bytes: Uint8Array): void;
    resize(cols: number, rows: number): void;
    take_replies(): string[];
    snapshot_json(): string;
  };
  WebShell: new (
    cols: number,
    rows: number,
  ) => {
    input(bytes: Uint8Array): Uint8Array;
    resize(cols: number, rows: number): void;
    exited(): boolean;
    snapshot_json(): string;
  };
  resize_frame(cols: number, rows: number): string;
  data_frame(bytes: Uint8Array): string;
}

export interface Snapshot {
  columns: number;
  rows: number;
  lines: string[];
  cursor: { row: number; col: number; visible: boolean };
}

/** Bytes in/out of a shell. Implementations: WebSocket, worker, local. */
export interface Transport {
  send(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  onOutput(cb: (bytes: Uint8Array) => void): void;
  close(): void;
}

export function webSocketTransport(wasm: WasmApi, url: string, WS: typeof WebSocket = WebSocket): Transport {
  const ws = new WS(url);
  ws.binaryType = "arraybuffer";
  let out: (b: Uint8Array) => void = noop;
  const queue: (() => void)[] = [];
  ws.addEventListener("open", () => queue.splice(0).forEach(f => f()));
  ws.addEventListener("message", (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) out(new Uint8Array(e.data));
  });
  const whenOpen = (f: () => void) => (ws.readyState === 1 ? f() : queue.push(f));
  return {
    send: b => whenOpen(() => ws.send(b as Uint8Array<ArrayBuffer>)),
    resize: (c, r) => whenOpen(() => ws.send(wasm.resize_frame(c, r))),
    onOutput: cb => (out = cb),
    close: () => ws.close(),
  };
}

export interface SandboxTransportOptions {
  /** Stable provider session ID; sent again on reconnect so a provider can resume it. */
  sessionId?: string;
  reconnectDelayMs?: number;
  maxReconnects?: number;
  WS?: typeof WebSocket;
}

/** Authenticated sandbox WebSocket with bounded reconnect and queued input. */
export function sandboxTransport(
  wasm: Pick<WasmApi, "resize_frame">,
  url: string,
  token: string,
  options: SandboxTransportOptions = {},
): Transport {
  const WS = options.WS ?? WebSocket;
  const endpoint = new URL(url);
  if (!token || !["ws:", "wss:"].includes(endpoint.protocol)) {
    throw new Error("sandbox transport requires a token and a WebSocket URL");
  }
  endpoint.searchParams.set("token", token);
  if (options.sessionId) endpoint.searchParams.set("session", options.sessionId);
  const delay = options.reconnectDelayMs ?? 500;
  const maxReconnects = options.maxReconnects ?? 5;
  let out: (bytes: Uint8Array) => void = noop;
  let closed = false;
  let reconnects = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let size: [number, number] | undefined;
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let ws: WebSocket;
  const connect = () => {
    const socket = new WS(endpoint.href);
    ws = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      if (socket !== ws || closed) return;
      reconnects = 0;
      if (size) socket.send(wasm.resize_frame(...size));
      for (const bytes of pending) socket.send(bytes as Uint8Array<ArrayBuffer>);
      pending.length = 0;
      pendingBytes = 0;
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (socket === ws && !closed && event.data instanceof ArrayBuffer) out(new Uint8Array(event.data));
    });
    socket.addEventListener("close", () => {
      if (socket === ws && !closed && reconnects < maxReconnects) {
        reconnects += 1;
        timer = setTimeout(connect, delay * Math.min(reconnects, 8));
      }
    });
  };
  connect();
  return {
    send: bytes => {
      const owned = Uint8Array.from(bytes);
      if (closed) return;
      if (ws.readyState === WS.OPEN) ws.send(owned as Uint8Array<ArrayBuffer>);
      else if (pendingBytes + owned.byteLength <= 1024 * 1024) {
        pending.push(owned);
        pendingBytes += owned.byteLength;
      } else throw new Error("sandbox input queue exceeds 1 MiB");
    },
    resize: (cols, rows) => {
      size = [cols, rows];
      if (ws.readyState === WS.OPEN) ws.send(wasm.resize_frame(cols, rows));
    },
    onOutput: cb => (out = cb),
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws.close();
    },
  };
}

export interface WorkerMessage {
  type: "ready" | "output" | "exited" | "closed" | "error";
  bytes?: ArrayBuffer;
  message?: string;
}

export interface ShellWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerMessage>) => void): void;
  terminate(): void;
}

/** OPFS-backed local shell. Its dedicated worker owns persistence and the shell engine. */
export function workerTransport(
  cols = 80,
  rows = 24,
  worker: ShellWorker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  }) as ShellWorker,
): Transport {
  let out: (bytes: Uint8Array) => void = noop;
  let closed = false;
  worker.addEventListener("message", ({ data }) => {
    if (closed && data.type !== "closed") return;
    if ((data.type === "ready" || data.type === "output") && data.bytes) out(new Uint8Array(data.bytes));
    else if (data.type === "error") {
      out(new TextEncoder().encode(`\r\n${data.message ?? "worker error"}\r\n`));
      closed = true;
      worker.terminate();
    } else if (data.type === "closed") worker.terminate();
  });
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage n'accepte pas d'origine : le second argument est la liste de transfert
  worker.postMessage({ type: "init", cols, rows });
  return {
    send: bytes => {
      if (closed) return;
      const owned = Uint8Array.from(bytes);
      worker.postMessage({ type: "input", bytes: owned.buffer }, [owned.buffer]);
    },
    resize: (c, r) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage n'accepte pas d'origine : le second argument est la liste de transfert
      if (!closed) worker.postMessage({ type: "resize", cols: c, rows: r });
    },
    onOutput: cb => (out = cb),
    close: () => {
      if (closed) return;
      closed = true;
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage n'accepte pas d'origine : le second argument est la liste de transfert
      worker.postMessage({ type: "close" });
    },
  };
}

/** Backend-less transport running the shell inside WASM. */
export function localTransport(wasm: WasmApi, cols = 80, rows = 24): Transport & { snapshot(): Snapshot } {
  const shell = new wasm.WebShell(cols, rows);
  let out: (b: Uint8Array) => void = noop;
  return {
    send: b => out(shell.input(b)),
    resize: (c, r) => shell.resize(c, r),
    onOutput: cb => (out = cb),
    close: () => {},
    snapshot: () => JSON.parse(shell.snapshot_json()) as Snapshot,
  };
}

/** Terminal bound to a transport: output bytes update the VT grid, VT replies flow back. */
export function attach(wasm: WasmApi, transport: Transport, cols = 80, rows = 24) {
  const term = new wasm.WebTerminal(cols, rows);
  transport.onOutput(bytes => {
    term.ingest(bytes);
    const enc = new TextEncoder();
    for (const reply of term.take_replies()) transport.send(enc.encode(reply));
  });
  transport.resize(cols, rows);
  return {
    snapshot: () => JSON.parse(term.snapshot_json()) as Snapshot,
    resize: (c: number, r: number) => (term.resize(c, r), transport.resize(c, r)),
    type: (text: string) => transport.send(new TextEncoder().encode(text)),
    close: () => transport.close(),
  };
}
