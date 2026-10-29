// SPDX-License-Identifier: Apache-2.0
/** Pinned browser artifacts for Gemma 4 E2B. Sizes are the byte counts of the Hub files at the pinned commit. */
export interface ShardFile {
  readonly path: string;
  readonly bytes: number;
}
export interface BrowserVariant {
  readonly id: string;
  readonly repo: string;
  readonly revision: string;
  readonly decoder: string;
  readonly embed: string;
  readonly vision: string;
  readonly files: readonly ShardFile[];
  /** Weight bytes resident on the GPU for the decoder (external data). */
  readonly gpuWeightBytes: number;
  /** Bytes the wasm heap must hold for the per-layer embedding session. */
  readonly wasmWeightBytes: number;
}

const REPO = "onnx-community/gemma-4-E2B-it-qat-mobile-ONNX";
const REV = "a7f19b0ab28252b77cea830f52b8290b2479c87d";

/** QAT "mobile" export: 2-bit decoder MLPs, 4-bit attention, fp16 activations, 2.3 GB for text. */
export const GEMMA4_E2B_QAT_MOBILE: BrowserVariant = {
  id: "gemma-4-e2b-it-qat-mobile-q2f16",
  repo: REPO,
  revision: REV,
  decoder: "onnx/decoder_model_merged_q2f16.onnx",
  embed: "onnx/embed_tokens_q2f16.onnx",
  vision: "onnx/vision_encoder_fp16.onnx",
  gpuWeightBytes: 994_621_440,
  wasmWeightBytes: 1_296_564_224,
  files: [
    { path: "config.json", bytes: 6673 },
    { path: "generation_config.json", bytes: 209 },
    { path: "tokenizer.json", bytes: 32_169_626 },
    { path: "tokenizer_config.json", bytes: 1877 },
    { path: "chat_template.jinja", bytes: 17_336 },
    { path: "onnx/decoder_model_merged_q2f16.onnx", bytes: 807_184 },
    { path: "onnx/decoder_model_merged_q2f16.onnx_data", bytes: 994_621_440 },
    { path: "onnx/embed_tokens_q2f16.onnx", bytes: 5491 },
    { path: "onnx/embed_tokens_q2f16.onnx_data", bytes: 1_296_564_224 },
  ],
};

export const VISION_FILES: readonly ShardFile[] = [
  { path: "onnx/vision_encoder_fp16.onnx", bytes: 222_019 },
  { path: "onnx/vision_encoder_fp16.onnx_data", bytes: 187_272_896 },
  { path: "preprocessor_config.json", bytes: 511 },
  { path: "processor_config.json", bytes: 1689 },
];

export function hubUrl(v: BrowserVariant, path: string, base = "https://huggingface.co"): string {
  return `${base}/${v.repo}/resolve/${v.revision}/${path}`;
}
export function totalBytes(v: BrowserVariant): number {
  return v.files.reduce((n, f) => n + f.bytes, 0);
}

/** Generation defaults from the model card (generation_config.json). */
export const GEMMA4_SAMPLING = { temperature: 1.0, topP: 0.95, topK: 64 } as const;
export const GEMMA4_EOS_IDS: readonly number[] = [1, 106, 50];
