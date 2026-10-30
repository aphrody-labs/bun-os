// SPDX-License-Identifier: Apache-2.0
// Browser runner: starts the worker, exposes window.gemma for the benchmark and a small chat UI.
import { GemmaOpenAI, GemmaWorkerClient, planBudget, type DeviceInfo } from "../src/index";

declare global {
  interface Window {
    gemma: {
      device(): Promise<DeviceInfo & { adapter?: string; plan: ReturnType<typeof planBudget> }>;
      load(o: { decoderEp?: "webgpu" | "wasm"; partBytes?: number }): Promise<unknown>;
      chat(o: { prompt: string; maxTokens?: number; seed?: number; temperature?: number }): Promise<unknown>;
      heap(): number | undefined;
    };
  }
}

const q = new URLSearchParams(location.search);
const modelBase = q.get("model") ?? undefined;
const progress = document.getElementById("progress")!;
const out = document.getElementById("out")!;
let client: GemmaWorkerClient | undefined;
let api: GemmaOpenAI | undefined;

async function device() {
  let webgpu = false;
  let adapterName: string | undefined;
  let maxBufferSize: number | undefined;
  let maxStorageBufferBindingSize: number | undefined;
  try {
    const a = await navigator.gpu?.requestAdapter();
    if (a) {
      webgpu = true;
      maxBufferSize = a.limits.maxBufferSize;
      maxStorageBufferBindingSize = a.limits.maxStorageBufferBindingSize;
      adapterName = (a.info ? `${a.info.vendor} ${a.info.architecture} ${a.info.description}` : "").trim();
    }
  } catch {}
  const info: DeviceInfo = {
    webgpu,
    maxBufferSize,
    maxStorageBufferBindingSize,
    deviceMemoryGiB: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    crossOriginIsolated: self.crossOriginIsolated,
  };
  return { ...info, adapter: adapterName, plan: planBudget(info) };
}

window.gemma = {
  device,
  async load(o) {
    client = new GemmaWorkerClient(new Worker(new URL("./worker.js", location.href), { type: "module" }));
    api = new GemmaOpenAI(client);
    return client.load({
      modelBase,
      ortBase: new URL("./ort/", location.href).href,
      decoderEp: o.decoderEp,
      partBytes: o.partBytes,
      onProgress: p => {
        progress.textContent = `${p.file} ${((100 * p.loaded) / p.total).toFixed(1)}%`;
      },
    });
  },
  async chat(o) {
    if (!api) throw new Error("load() first");
    const t0 = performance.now();
    let text = "";
    let first = 0;
    let chunks = 0;
    let usage: unknown;
    for await (const c of api.chat.completions.create({
      messages: [{ role: "user", content: o.prompt }],
      stream: true,
      max_tokens: o.maxTokens ?? 64,
      seed: o.seed ?? 1,
      temperature: o.temperature ?? 0,
    })) {
      const d = c.choices[0]?.delta.content;
      if (d) {
        if (!first) first = performance.now();
        text += d;
        chunks++;
        out.textContent = text;
      }
      if (c.usage) usage = c.usage;
    }
    return { text, usage, chunks, firstChunkMs: first - t0, totalMs: performance.now() - t0 };
  },
  heap: () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize,
};
