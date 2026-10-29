// SPDX-License-Identifier: Apache-2.0
import type * as OrtNs from "onnxruntime-web";
import { Template } from "@huggingface/jinja";
import { Tokenizer } from "@huggingface/tokenizers";
import { GEMMA4_E2B_QAT_MOBILE, GEMMA4_EOS_IDS, GEMMA4_SAMPLING, type BrowserVariant } from "./catalog";
import { ShardStore, type FetchProgress } from "./cache";
import { toFloat32 } from "./fp16";
import { mulberry32, sampleToken } from "./sampler";

type Ort = typeof OrtNs;
type Tensor = OrtNs.Tensor;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface GenerateOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  seed?: number;
  stop?: string[];
  signal?: AbortSignal;
}
export interface GenerateStats {
  promptTokens: number;
  completionTokens: number;
  /** Time from generate() to the first token (prefill + first decode), ms. */
  ttftMs: number;
  /** Decode speed after the first token, tokens per second. */
  decodeTps: number;
  totalMs: number;
  finishReason: "stop" | "length" | "abort";
}
export interface LoadStats {
  downloadMs: number;
  sessionMs: number;
  decoderEp: string;
  embedEp: string;
  inputNames: string[];
  kvLayers: number;
}
export interface EngineOptions {
  ort: Ort;
  store: ShardStore;
  variant?: BrowserVariant;
  /** "webgpu" (default) runs the decoder on the GPU; "wasm" runs everything on the CPU. */
  decoderEp?: "webgpu" | "wasm";
  onProgress?(p: FetchProgress): void;
}

const I64 = "int64" as const;

export class GemmaWebEngine {
  readonly variant: BrowserVariant;
  #ort: Ort;
  #store: ShardStore;
  #ep: "webgpu" | "wasm";
  #tok!: Tokenizer;
  #tpl!: Template;
  #embed!: OrtNs.InferenceSession;
  #dec!: OrtNs.InferenceSession;
  #kv: { name: string; type: "float16" | "float32"; heads: number; dim: number }[] = [];
  #eos = new Set<number>(GEMMA4_EOS_IDS);
  #busy = false;
  #loadStats?: LoadStats;

  constructor(o: EngineOptions) {
    this.#ort = o.ort;
    this.#store = o.store;
    this.variant = o.variant ?? GEMMA4_E2B_QAT_MOBILE;
    this.#ep = o.decoderEp ?? "webgpu";
  }

  get loadStats() {
    return this.#loadStats;
  }
  get loaded() {
    return !!this.#dec;
  }

  async load(): Promise<LoadStats> {
    const v = this.variant;
    const ort = this.#ort;
    const file = (p: string) => v.files.find((f) => f.path === p)!.bytes;
    const t0 = performance.now();
    this.#store.plan(v.files);
    const tokJson = JSON.parse(await this.#store.text("tokenizer.json", file("tokenizer.json")));
    const tokCfg = JSON.parse(await this.#store.text("tokenizer_config.json", file("tokenizer_config.json")));
    this.#tok = new Tokenizer(tokJson, tokCfg);
    this.#tpl = new Template(await this.#store.text("chat_template.jinja", file("chat_template.jinja")));
    const gen = JSON.parse(await this.#store.text("generation_config.json", file("generation_config.json")));
    for (const id of [gen.eos_token_id].flat()) this.#eos.add(id);

    const t1 = performance.now();
    const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    // Fetch and build one session at a time and drop the weight bytes right after, so the page never
    // holds more than one multi-GB buffer next to the sessions it already created.
    let fetchMs = performance.now() - t0; // tokenizer + config so far
    const session = async (model: string, ep: "webgpu" | "wasm", gpuOut: boolean) => {
      const tf = performance.now();
      let weights: Uint8Array | undefined = await this.#store.get(model + "_data", file(model + "_data"));
      const graph = await this.#store.get(model, file(model));
      fetchMs += performance.now() - tf;
      const s = await ort.InferenceSession.create(graph, {
        executionProviders: [ep],
        graphOptimizationLevel: "all",
        preferredOutputLocation: gpuOut ? "gpu-buffer" : undefined,
        externalData: [{ path: base(model) + "_data", data: weights }],
      });
      weights = undefined;
      return s;
    };
    // The q2f16 export stores the per-layer embedding table with com.microsoft.GatherBlockQuantized,
    // which ORT Web implements only in the WebGPU EP (the wasm CPU EP has no kernel for it), so the
    // 1.3 GB table lives on the GPU next to the decoder. Only the gathered rows come back to the CPU.
    this.#embed = await session(v.embed, this.#ep, false);
    this.#dec = await session(v.decoder, this.#ep, this.#ep === "webgpu");
    const meta = (this.#dec as unknown as { inputMetadata?: readonly Record<string, unknown>[] }).inputMetadata ?? [];
    this.#kv = [];
    for (const name of this.#dec.inputNames.filter((n) => n.startsWith("past_key_values"))) {
      const m = meta.find((x) => x["name"] === name) as { type?: string; shape?: (number | string)[] } | undefined;
      this.#kv.push({
        name,
        type: m?.type === "float32" ? "float32" : "float16",
        heads: Number(m?.shape?.[1] ?? 1),
        dim: Number(m?.shape?.[3] ?? 256),
      });
    }
    this.#loadStats = {
      downloadMs: fetchMs,
      sessionMs: performance.now() - t0 - fetchMs,
      decoderEp: this.#ep,
      embedEp: this.#ep,
      inputNames: [...this.#dec.inputNames],
      kvLayers: this.#kv.length / 2,
    };
    return this.#loadStats;
  }

  encodeChat(messages: ChatMessage[]): number[] {
    const text = this.#tpl.render({ messages, add_generation_prompt: true, bos_token: "<bos>", eos_token: "<eos>" });
    return this.#tok.encode(text, { add_special_tokens: false }).ids;
  }
  decode(ids: number[]): string {
    return this.#tok.decode(ids, { skip_special_tokens: true });
  }

  #emptyKv(): Record<string, Tensor> {
    const out: Record<string, Tensor> = {};
    for (const k of this.#kv) {
      const data = k.type === "float32" ? new Float32Array(0) : new Uint16Array(0);
      out[k.name] = new this.#ort.Tensor(k.type, data, [1, k.heads, 0, k.dim]);
    }
    return out;
  }

  async #step(
    ids: number[],
    pastLen: number,
    kv: Record<string, Tensor>,
  ): Promise<{ logits: Float32Array; kv: Record<string, Tensor> }> {
    const ort = this.#ort;
    const n = ids.length;
    const e = await this.#embed.run({ input_ids: new ort.Tensor(I64, BigInt64Array.from(ids.map(BigInt)), [1, n]) });
    const feeds: Record<string, Tensor> = {
      inputs_embeds: e["inputs_embeds"]!,
      per_layer_inputs: e["per_layer_inputs"]!,
      attention_mask: new ort.Tensor(I64, new BigInt64Array(pastLen + n).fill(1n), [1, pastLen + n]),
      position_ids: new ort.Tensor(I64, BigInt64Array.from(ids.map((_, i) => BigInt(pastLen + i))), [1, n]),
      num_logits_to_keep: new ort.Tensor(I64, BigInt64Array.from([1n]), []),
      ...kv,
    };
    for (const k of Object.keys(feeds)) if (!this.#dec.inputNames.includes(k)) delete feeds[k];
    const out = await this.#dec.run(feeds);
    const logitsT = out["logits"]!;
    const raw = (await logitsT.getData()) as ArrayLike<number>;
    const vocab = logitsT.dims[logitsT.dims.length - 1]!;
    const all = toFloat32(raw);
    const logits = all.length === vocab ? all : all.subarray(all.length - vocab);
    const next: Record<string, Tensor> = {};
    for (const k of this.#kv) next[k.name] = out[k.name.replace("past_key_values", "present")]!;
    for (const t of Object.values(kv)) t.dispose();
    for (const t of [e["inputs_embeds"]!, e["per_layer_inputs"]!, logitsT]) t.dispose();
    return { logits, kv: next };
  }

  /** Stream decoded text deltas; the returned stats arrive as the generator's return value. */
  async *generate(o: GenerateOptions): AsyncGenerator<string, GenerateStats, void> {
    if (!this.loaded) throw new Error("engine not loaded");
    if (this.#busy) throw new Error("engine is busy: one generation at a time");
    this.#busy = true;
    const t0 = performance.now();
    const maxTokens = o.maxTokens ?? 256;
    const rnd = mulberry32(o.seed ?? (Math.random() * 2 ** 32) >>> 0);
    const sampler = {
      temperature: o.temperature ?? GEMMA4_SAMPLING.temperature,
      topP: o.topP ?? GEMMA4_SAMPLING.topP,
      topK: o.topK ?? GEMMA4_SAMPLING.topK,
    };
    const prompt = this.encodeChat(o.messages);
    let kv = this.#emptyKv();
    let pastLen = 0;
    const gen: number[] = [];
    let emitted = "";
    let tFirst = 0;
    let finish: GenerateStats["finishReason"] = "length";
    try {
      // prefill in chunks so the first run never needs a prompt-sized activation
      const CHUNK = 512;
      let last!: Float32Array;
      for (let i = 0; i < prompt.length; i += CHUNK) {
        const part = prompt.slice(i, i + CHUNK);
        const r = await this.#step(part, pastLen, kv);
        kv = r.kv;
        pastLen += part.length;
        last = r.logits;
      }
      for (;;) {
        if (o.signal?.aborted) {
          finish = "abort";
          break;
        }
        const tok = sampleToken(last, sampler, rnd);
        if (!tFirst) tFirst = performance.now();
        if (this.#eos.has(tok)) {
          finish = "stop";
          break;
        }
        gen.push(tok);
        const text = this.decode(gen);
        let delta = text.slice(emitted.length);
        if (delta.endsWith("�")) delta = ""; // incomplete UTF-8 sequence, wait for the next token
        if (delta) {
          emitted = text;
          const stopAt = o.stop?.map((s) => text.indexOf(s)).filter((x) => x >= 0);
          if (stopAt?.length) {
            const cut = Math.min(...stopAt);
            const keep = text.slice(0, cut);
            if (keep.length > emitted.length - delta.length) yield keep.slice(emitted.length - delta.length);
            finish = "stop";
            break;
          }
          yield delta;
        }
        if (gen.length >= maxTokens) break;
        const r = await this.#step([tok], pastLen, kv);
        kv = r.kv;
        pastLen += 1;
        last = r.logits;
      }
    } finally {
      for (const t of Object.values(kv)) t.dispose();
      this.#busy = false;
    }
    const t1 = performance.now();
    return {
      promptTokens: prompt.length,
      completionTokens: gen.length,
      ttftMs: (tFirst || t1) - t0,
      decodeTps: gen.length > 1 && tFirst ? ((gen.length - 1) * 1000) / (t1 - tFirst) : 0,
      totalMs: t1 - t0,
      finishReason: finish,
    };
  }

  async dispose() {
    await this.#dec?.release();
    await this.#embed?.release();
  }
}
