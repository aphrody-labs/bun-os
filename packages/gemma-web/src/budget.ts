// SPDX-License-Identifier: Apache-2.0
import { GEMMA4_E2B_QAT_MOBILE, totalBytes, type BrowserVariant } from "./catalog";

export interface TextConfig {
  num_hidden_layers: number;
  num_kv_shared_layers: number;
  num_key_value_heads: number;
  head_dim: number;
  global_head_dim: number;
  layer_types: string[];
}

/** Text-model constants of the pinned ONNX export (config.json text_config). */
export const GEMMA4_E2B_TEXT_CONFIG: TextConfig = {
  num_hidden_layers: 35,
  num_kv_shared_layers: 20,
  num_key_value_heads: 1,
  head_dim: 256,
  global_head_dim: 512,
  layer_types: Array.from({ length: 35 }, (_, i) => ((i + 1) % 5 === 0 ? "full_attention" : "sliding_attention")),
};

/**
 * fp16 KV bytes for `tokens` of context. The ONNX decoder concatenates `present` onto `past`
 * with no ring buffer, so sliding layers are counted at full length too. The last
 * `num_kv_shared_layers` layers reuse earlier K/V and own no cache.
 */
export function kvBytes(tokens: number, c: TextConfig = GEMMA4_E2B_TEXT_CONFIG): number {
  const own = c.num_hidden_layers - c.num_kv_shared_layers;
  let perToken = 0;
  for (let i = 0; i < own; i++) {
    const dim = c.layer_types[i] === "full_attention" ? c.global_head_dim : c.head_dim;
    perToken += 2 * c.num_key_value_heads * dim * 2;
  }
  return perToken * tokens;
}

export interface DeviceInfo {
  /** navigator.deviceMemory in GiB (capped at 8 by browsers); undefined when unknown. */
  deviceMemoryGiB?: number | undefined;
  /** GPUAdapter limits.maxBufferSize, bytes; undefined without WebGPU. */
  maxBufferSize?: number | undefined;
  /** GPUAdapter limits.maxStorageBufferBindingSize, bytes. */
  maxStorageBufferBindingSize?: number | undefined;
  webgpu: boolean;
  crossOriginIsolated?: boolean | undefined;
}

export interface BudgetPlan {
  decoderEp: "webgpu" | "wasm";
  downloadBytes: number;
  gpuBytes: number;
  wasmHeapBytes: number;
  contextTokens: number;
  kvBytesAtContext: number;
  warnings: string[];
}

const WASM32_LIMIT = 4 * 1024 ** 3;

/** Decide where the decoder runs and how much context fits, from what the browser reports. */
export function planBudget(d: DeviceInfo, v: BrowserVariant = GEMMA4_E2B_QAT_MOBILE, wantContext = 8192): BudgetPlan {
  const warnings: string[] = [];
  const decoderEp = d.webgpu ? "webgpu" : "wasm";
  if (!d.webgpu) warnings.push("WebGPU unavailable: decoder falls back to wasm CPU (slow).");
  // wasm heap holds the per-layer embedding table (+ the decoder weights when on CPU).
  const wasmHeapBytes = v.wasmWeightBytes + (decoderEp === "wasm" ? v.gpuWeightBytes : 0) + 256 * 1024 ** 2;
  if (wasmHeapBytes > WASM32_LIMIT * 0.9) warnings.push("wasm32 heap near its 4 GiB address-space limit.");
  if (d.maxBufferSize !== undefined && d.maxBufferSize < v.gpuWeightBytes)
    warnings.push(
      `adapter maxBufferSize ${d.maxBufferSize} < decoder weights ${v.gpuWeightBytes}; ONNX Runtime splits weights per initializer, but a single tensor above the limit will fail.`,
    );
  if (!d.crossOriginIsolated) warnings.push("not cross-origin isolated: wasm runs single-threaded (set COOP/COEP).");
  const ceiling = d.deviceMemoryGiB !== undefined ? d.deviceMemoryGiB * 1024 ** 3 : 8 * 1024 ** 3;
  const fixed = v.gpuWeightBytes + wasmHeapBytes;
  let contextTokens = wantContext;
  while (contextTokens > 512 && fixed + kvBytes(contextTokens) > ceiling * 0.8)
    contextTokens = Math.floor(contextTokens / 2);
  if (fixed + kvBytes(contextTokens) > ceiling * 0.8)
    warnings.push("memory budget below the working set even at 512 tokens.");
  return {
    decoderEp,
    downloadBytes: totalBytes(v),
    gpuBytes: v.gpuWeightBytes + kvBytes(contextTokens),
    wasmHeapBytes,
    contextTokens,
    kvBytesAtContext: kvBytes(contextTokens),
    warnings,
  };
}
