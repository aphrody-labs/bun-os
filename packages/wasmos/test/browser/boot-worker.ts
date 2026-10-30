// Browser (Web Worker) host of a container2wasm WASI image on @bjorn3/browser_wasi_shim.
import { WASI, ConsoleStdout, OpenFile, File } from "@bjorn3/browser_wasi_shim";
import { makePollOneoff } from "../../src/poll.ts";

self.onmessage = async (ev: MessageEvent<{ wasm: string; args: string[] }>) => {
  const t0 = performance.now();
  let out = "";
  const sink = (tag: string) =>
    ConsoleStdout.lineBuffered(line => ((out += tag + line + "\n"), console.log("[guest]", tag + line)));
  try {
    const bytes = await (await fetch(ev.data.wasm)).arrayBuffer();
    const wasi = new WASI(["wasmos", ...ev.data.args], [], [new OpenFile(new File([])), sink(""), sink("[err] ")]);
    let memory: WebAssembly.Memory;
    (wasi.wasiImport as any).poll_oneoff = makePollOneoff(() => memory); // the shim only supports one subscription
    const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi.wasiImport });
    memory = instance.exports.memory as WebAssembly.Memory;
    const code = wasi.start(instance as any);
    (self as any).postMessage({ out, code, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    (self as any).postMessage({ out, error: String(e), ms: Math.round(performance.now() - t0) });
  }
};
