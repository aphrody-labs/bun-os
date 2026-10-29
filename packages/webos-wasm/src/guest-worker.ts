// SPDX-License-Identifier: Apache-2.0
// Web Worker that runs the Alpine guest (container2wasm: Bochs x86_64 + Linux) for the WebOS Terminal.
// Stdin comes from a SharedArrayBuffer ring written by the page, stdout is posted as it is written. The 110 MB image is
// streamed once into OPFS and instantiated from there on every later start.
import { Fd, WASI, wasi } from "@bjorn3/browser_wasi_shim";
import { StdinRing, makeInteractivePoll } from "../../wasmos/src/interactive.ts";

export interface GuestStart {
  wasm: string;
  args: string[];
  stdin: SharedArrayBuffer;
}
export type GuestMessage =
  | { out: Uint8Array }
  | { err: Uint8Array }
  | { progress: { done: number; total: number; cached: boolean } }
  | { started: true }
  | { exit: number }
  | { error: string };

const post = (m: GuestMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

class Stdin extends Fd {
  constructor(private readonly ring: StdinRing) {
    super();
  }
  fd_fdstat_get() {
    const s = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
    s.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
    return { ret: 0, fdstat: s };
  }
  fd_filestat_get() {
    return { ret: 0, filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, 0n) };
  }
  fd_read(size: number) {
    while (this.ring.available() === 0) this.ring.wait(1000);
    return { ret: 0, data: this.ring.read(size) };
  }
}

class Stdout extends Fd {
  constructor(private readonly tag: "out" | "err") {
    super();
  }
  fd_fdstat_get() {
    const s = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
    s.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE);
    return { ret: 0, fdstat: s };
  }
  fd_filestat_get() {
    return { ret: 0, filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, 0n) };
  }
  fd_write(data: Uint8Array) {
    const copy = data.slice();
    post(this.tag === "out" ? { out: copy } : { err: copy }, [copy.buffer]);
    return { ret: 0, nwritten: data.byteLength };
  }
}

const FILE = "guest-image.wasm";
const META = "guest-image.json";

/** The image as a Response: from OPFS when the cached copy matches the server's etag and size, else streamed in. */
export async function openImage(url: string, progress: (done: number, total: number, cached: boolean) => void) {
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) throw new Error(`guest image: HTTP ${head.status}`);
  const size = Number(head.headers.get("content-length") ?? 0);
  const etag = head.headers.get("etag") ?? "";
  const headers = { "content-type": "application/wasm" };
  let dir: FileSystemDirectoryHandle | undefined;
  try {
    dir = await navigator.storage.getDirectory();
  } catch {
    dir = undefined; // no OPFS: stream straight into the compiler
  }
  if (dir) {
    try {
      const meta = JSON.parse(await (await (await dir.getFileHandle(META)).getFile()).text()) as {
        etag: string;
        size: number;
      };
      const file = await (await dir.getFileHandle(FILE)).getFile();
      if (meta.etag === etag && meta.size === size && file.size === size) {
        progress(size, size, true);
        return new Response(file, { headers });
      }
    } catch {
      // not cached yet
    }
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`guest image: HTTP ${res.status}`);
  let done = 0;
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        done += chunk.byteLength;
        progress(done, size, false);
        controller.enqueue(chunk);
      },
    }),
  );
  if (!dir) return new Response(counted, { headers });
  const handle = await dir.getFileHandle(FILE, { create: true });
  const writable = await handle.createWritable();
  await counted.pipeTo(writable);
  const meta = await (await dir.getFileHandle(META, { create: true })).createWritable();
  await meta.write(JSON.stringify({ etag, size }));
  await meta.close();
  return new Response(await handle.getFile(), { headers });
}

self.onmessage = async (ev: MessageEvent<GuestStart>) => {
  try {
    const ring = new StdinRing(ev.data.stdin);
    const image = await openImage(ev.data.wasm, (done, total, cached) => post({ progress: { done, total, cached } }));
    const wasi_ = new WASI(["wasmos", ...ev.data.args], [], [new Stdin(ring), new Stdout("out"), new Stdout("err")]);
    let memory: WebAssembly.Memory;
    (wasi_.wasiImport as Record<string, unknown>).poll_oneoff = makeInteractivePoll(() => memory, ring);
    const compiled = (await WebAssembly.instantiateStreaming(image, {
      wasi_snapshot_preview1: wasi_.wasiImport,
    })) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
    memory = compiled.instance.exports.memory as WebAssembly.Memory;
    post({ started: true });
    const code = wasi_.start(compiled.instance as never);
    post({ exit: code });
  } catch (e) {
    post({ error: String(e) });
  }
};
