// Browser (Web Worker) host of an interactive container2wasm guest: stdin comes from a SharedArrayBuffer ring written by
// the page, stdout is posted to the page as it is written (unbuffered, so a prompt without a newline still shows).
import { WASI, Fd, wasi } from "@bjorn3/browser_wasi_shim";
import { StdinRing, makeInteractivePoll } from "../../src/interactive.ts";

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
    (self as any).postMessage({ [this.tag]: copy }, [copy.buffer]);
    return { ret: 0, nwritten: data.byteLength };
  }
}

self.onmessage = async (ev: MessageEvent<{ wasm: string; args: string[]; stdin: SharedArrayBuffer }>) => {
  try {
    const ring = new StdinRing(ev.data.stdin);
    const bytes = await (await fetch(ev.data.wasm)).arrayBuffer();
    const wasi_ = new WASI(["wasmos", ...ev.data.args], [], [new Stdin(ring), new Stdout("out"), new Stdout("err")]);
    let memory: WebAssembly.Memory;
    (wasi_.wasiImport as any).poll_oneoff = makeInteractivePoll(() => memory, ring);
    const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi_.wasiImport });
    memory = instance.exports.memory as WebAssembly.Memory;
    (self as any).postMessage({ started: true });
    const code = wasi_.start(instance as any);
    (self as any).postMessage({ exit: code });
  } catch (e) {
    (self as any).postMessage({ error: String(e) });
  }
};
