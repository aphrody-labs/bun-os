// SPDX-License-Identifier: Apache-2.0
import type { FetchProgress } from "./cache";
import type { GenerateOptions, GenerateStats, LoadStats } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/** What the OpenAI-style client needs from an engine, whether in-page or behind a Worker. */
export interface GemmaBackend {
  generate(opts: GenerateOptions): AsyncGenerator<string, GenerateStats, void>;
}

export interface LoadOptions {
  modelBase?: string;
  ortBase?: string;
  decoderEp?: "webgpu" | "wasm";
  partBytes?: number;
  onProgress?(p: FetchProgress): void;
}

/** Main-thread proxy of the engine running in `worker.ts`. */
export class GemmaWorkerClient implements GemmaBackend {
  #w: Worker;
  #id = 0;
  #listeners = new Set<(m: WorkerResponse) => void>();
  constructor(worker: Worker) {
    this.#w = worker;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      for (const l of this.#listeners) l(e.data);
    };
    worker.onerror = e => {
      for (const l of this.#listeners) l({ type: "error", message: e.message });
    };
  }
  #send(m: WorkerRequest) {
    this.#w.postMessage(m);
  }

  load(o: LoadOptions = {}): Promise<LoadStats> {
    return new Promise((resolve, reject) => {
      const l = (m: WorkerResponse) => {
        if (m.type === "progress") o.onProgress?.(m.p);
        else if (m.type === "loaded") {
          this.#listeners.delete(l);
          resolve(m.stats);
        } else if (m.type === "error" && m.id === undefined) {
          this.#listeners.delete(l);
          reject(new Error(m.message));
        }
      };
      this.#listeners.add(l);
      const { onProgress: _p, ...rest } = o;
      this.#send({ type: "load", ...rest });
    });
  }

  async *generate(opts: GenerateOptions): AsyncGenerator<string, GenerateStats, void> {
    const id = ++this.#id;
    const queue: WorkerResponse[] = [];
    let wake: (() => void) | undefined;
    const l = (m: WorkerResponse) => {
      if ("id" in m && m.id !== id && m.id !== undefined) return;
      if (m.type === "progress" || m.type === "loaded") return;
      queue.push(m);
      wake?.();
    };
    this.#listeners.add(l);
    const { signal, ...rest } = opts;
    const onAbort = () => this.#send({ type: "abort", id });
    signal?.addEventListener("abort", onAbort, { once: true });
    this.#send({ type: "generate", id, opts: rest });
    try {
      for (;;) {
        while (!queue.length) await new Promise<void>(r => (wake = r));
        const m = queue.shift()!;
        if (m.type === "delta") yield m.text;
        else if (m.type === "done") return m.stats;
        else if (m.type === "error") throw new Error(m.message);
      }
    } finally {
      this.#listeners.delete(l);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  dispose() {
    this.#send({ type: "dispose" });
    this.#w.terminate();
  }
}
