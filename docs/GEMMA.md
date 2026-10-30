<!-- SPDX-License-Identifier: Apache-2.0 -->
# Gemma 4 E2B and Qwen3.8 27B: local, WebGPU, wasm

Status 2026-10-29: work paused by the owner. Only measured facts and verified sources are listed;
everything else is in "Not done".

## Artifacts (verified on the Hub, 2026-10-29)

| Use | Artifact | Pin | Why |
| --- | --- | --- | --- |
| Reference weights | `google/gemma-4-E2B` (base, not instruction-tuned, 5.12 B params with per-layer embeddings, 10 246 621 918 B safetensors) | `d29ff6b45f081a49ee2733a859c9c9c2d95d1a6f` | The model named in the request. Apache-2.0 with the Gemma 4 licence link. The chat artifacts are the `-it` variants. |
| Native chat | `ggml-org/gemma-4-E2B-it-GGUF` (Q8_0 4.97 GB, Q4_0 2.84 GB, mmproj Q8_0 557 MB, MTP heads) | `main` at 2026-10-29 | Published by the llama.cpp organisation; `google/gemma-4-E2B-it-qat-q4_0-gguf` (3.35 GB, QAT) is the official alternative. |
| WebGPU | `onnx-community/gemma-4-E2B-it-qat-mobile-ONNX` (q2f16 decoder 995 MB, embeddings 1.30 GB, vision fp16 187 MB, audio q2f16 92 MB) | `a7f19b0ab28252b77cea830f52b8290b2479c87d` | Smallest browser export (2.32 GB for text), every file under 2 GiB. The `onnx-community/gemma-4-E2B-it-ONNX` export has a 9.4 GB embedding shard. |
| Other web route (not tried) | `litert-community/gemma-4-E2B-it-litert-lm` (`-web.litertlm`, `-web.task`, 2.0 GB) | `1caa527c1e…` | MediaPipe / LiteRT-LM for web. |
| Desktop-large | `JonathanColetti/Qwen3.8-27B-Uncensored-GGUF`, `Qwen3.8-27B-Uncensored-Q4_K_M.gguf` (16 810 714 528 B) | `45d0fc0ad6cfcf9eeee6008ddaea925536409b18`, sha256 `4c5e2db0…9675` | Apache-2.0, Heretic refusal removal (no fine-tuning), imatrix published, MTP head kept, wikitext-2 perplexity 7.1814 vs 7.1557 for f16 (author's measure). Alternatives looked at: `huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF`, `bartowski/orcarouter_Qwen3.8-27B-Uncensored-GGUF`. |

Qwen3.8-27B declares `Qwen3_5ForConditionalGeneration` / `model_type qwen3_5`, which the pinned
llama.cpp implements (`src/models/qwen35.cpp`). Gemma 4 is implemented in `src/models/gemma4.cpp`
and `conversion/gemma.py`.

The "uncensored" Qwen is the user's explicit choice; its use is the user's responsibility. The base
model is Apache-2.0. No weights are committed.

## Pins

- llama.cpp release `b11985`, commit `6d194531e1e5876d5d1a0641ce3ca7dae23f94ad` (2026-10-29).
- ONNX Runtime Web `1.31.1`, `@huggingface/tokenizers` 0.2.0, `@huggingface/jinja` 0.5.11.
- Emscripten 6.0.5 (LLVM 21) on the VPS; Chrome stable on the workstation.

## Measured

### Native, CPU (VPS, 12 vCPU Intel Haswell, shared host, `llama-bench -p 128 -n 64 -t 12 -r 2`)

| Model | pp128 t/s | tg64 t/s |
| --- | ---: | ---: |
| ggml-org Gemma 4 E2B it Q8_0 | 32.00 ± 0.07 | 4.29 ± 3.65 |
| ggml-org Gemma 4 E2B it Q4_0 | 29.96 ± 7.82 | 1.93 ± 2.13 |

The standard deviations show a loaded host (other jobs ran during the run), so only the order of
magnitude is meaningful; repeat on an idle machine. `convert_hf_to_gguf.py` converted the base
safetensors to a 9.31 GB BF16 GGUF in 6 min 9 s, and `llama-quantize` produced Q8_0 (4.97 GB) and
Q4_K_M from it.

### WebGPU, Chrome headless, RTX 4070 12 GB (`packages/gemma-web`, `bun scripts/bench-chrome.ts`)

- The adapter was reported as `nvidia lovelace`; `maxBufferSize` 2 GiB.
- Greedy answer to "Explain in two sentences why the sky is blue." is correct and fluent
  (Rayleigh scattering), identical on every run.
- Warm run (second request): time to first token 70 to 94 ms, 49 tokens in 1.5 to 2.3 s, that is
  about 33 tokens/s at best (48 tokens in 1.43 s); the 21 tokens/s run was made while a 17 GB
  download saturated the disk.
- First request after load: 2.8 s to 15.8 s time to first token (WebGPU pipeline compilation).
- GPU memory delta about 2.5 GB; process-tree resident memory peaked at 7.4 to 8.1 GB. The loader
  has since been changed to build one session at a time and release the weight bytes, which has
  not been re-measured.
- Load time is not reported: both runs overlapped a large download and the origin changed on every
  run (random port), so the OPFS cache was never hit.
- The per-layer embedding graph uses `com.microsoft.GatherBlockQuantized`; the wasm CPU provider
  has no kernel for it (`Failed to find kernel … CPUExecutionProvider`). The table therefore sits
  on the GPU (1.3 GB) next to the decoder (1.0 GB), not in wasm memory.

## Not done (nothing below was run)

- Logit/KL comparison of the GGUF against a transformers reference, image input through
  `llama-mtmd-cli`, and the 5-prompt quality check.
- The wasm builds: `packages/gemma-wasm` holds the C++ front end, CMake and build script, but no
  Emscripten build was attempted, so there is no wasm size, speed or memory number and no
  wasmtime / `node:wasi` run. wasm32 is limited to 4 GiB of address space; the 2.8 GB Q4_0 GGUF
  plus KV and compute buffers is close to it, so memory64 or a 2-bit quant is expected to be
  needed (unverified).
- Qwen3.8 27B: 16.2 of 16.8 GB downloaded, never loaded; no tokens/s, context or offload numbers.
- The Rust gateway, models hub, `yolo-core` backends, assistant overlay selector, wasmos loader,
  `.github/workflows/gemma.yml`, `just map`, `components.json`, git-profiles cone.
  `packages/yolo-core/src/gemma4` is configuration profiles plus an HTTP client to an external
  provider; it executes nothing itself.

## Reproduce

```sh
# weights stay outside the repository
huggingface=https://huggingface.co/onnx-community/gemma-4-E2B-it-qat-mobile-ONNX/resolve/a7f19b0ab28252b77cea830f52b8290b2479c87d
bun install && cd packages/gemma-web && bun scripts/build-web.ts
bun scripts/bench-chrome.ts --model-dir <dir with the ONNX snapshot> --port 8099 --profile <dir>
bun test            # CPU-only unit tests, no weights
```
