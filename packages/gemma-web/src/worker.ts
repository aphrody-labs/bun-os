// SPDX-License-Identifier: Apache-2.0
/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/webgpu";
import { OpfsStorage, ShardStore } from "./cache";
import { GEMMA4_E2B_QAT_MOBILE, hubUrl } from "./catalog";
import { GemmaWebEngine, type GenerateOptions } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;
const post = (m: WorkerResponse) => self.postMessage(m);

let engine: GemmaWebEngine | undefined;
const aborts = new Map<number, AbortController>();

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  try {
    if (m.type === "load") {
      const variant = GEMMA4_E2B_QAT_MOBILE;
      if (m.ortBase) ort.env.wasm.wasmPaths = m.ortBase;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const base = m.modelBase;
      const store = new ShardStore({
        url: p => (base ? `${base.replace(/\/$/, "")}/${p}` : hubUrl(variant, p)),
        storage: new OpfsStorage(`gemma-web-${variant.revision.slice(0, 12)}`),
        namespace: variant.revision.slice(0, 12),
        partBytes: m.partBytes,
        onProgress: p => post({ type: "progress", p }),
      });
      engine = new GemmaWebEngine({ ort, store, variant, decoderEp: m.decoderEp ?? "webgpu" });
      post({ type: "loaded", stats: await engine.load() });
    } else if (m.type === "generate") {
      if (!engine) throw new Error("not loaded");
      const ac = new AbortController();
      aborts.set(m.id, ac);
      const opts: GenerateOptions = { ...m.opts, signal: ac.signal };
      const it = engine.generate(opts);
      for (;;) {
        const r = await it.next();
        if (r.done) {
          post({ type: "done", id: m.id, stats: r.value });
          break;
        }
        post({ type: "delta", id: m.id, text: r.value });
      }
      aborts.delete(m.id);
    } else if (m.type === "abort") aborts.get(m.id)?.abort();
    else if (m.type === "dispose") {
      await engine?.dispose();
      engine = undefined;
    }
  } catch (e) {
    post({ type: "error", id: "id" in m ? m.id : undefined, message: e instanceof Error ? e.message : String(e) });
  }
};
