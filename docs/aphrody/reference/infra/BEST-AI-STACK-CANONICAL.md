> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Canonical AI stack

> Path reconciliation (2026-10-07): `crates/os/execpolicy` (not in repo) → `crates/os/kernel/core/src/execpolicy`; `plugins/aphrody/skills/best-stack-2026` (not in repo) → `plugins/yolo/skills/best-stack-2026`. Original dated observations below retain their historical scope.

> The source paths below include historical category-repository locations.
> Resolve current ownership using the monorepo root workspace and current
> manifests before adding or changing a dependency; package/crate names may
> remain stable while their paths have moved.

Single source of truth for AI/agent technology choices across the Aphrody repositories. The
`best-stack-2026` skill (`plugins/yolo/skills/best-stack-2026`) points here for
every AI row; general Rust crate choices stay in that skill.

Audited 2026-09-26 against live release pages (links per row). Versions drift: re-check the
linked page before pinning, and never copy a number from this file without re-verifying it.

## Rules

1. **Aphrody first.** Every need is covered by an existing Aphrody crate or command (see the
   generated catalog [`ecosystem/ECOSYSTEM.md`](../../ecosystem/ECOSYSTEM.md) and
   [`ecosystem/CLI.md`](../../ecosystem/CLI.md)). Extend that owner; never add a parallel component.
2. **Third-party projects are upstream dependencies or references**, not replacements. A
   third-party web UI, agent framework or cloud sandbox is never the recommended answer.
3. **Bleeding edge by operator preference.** Track the newest pre-release/nightly channel
   first; the stable release is the fallback when the pre-release breaks a gate.
4. Search before building: `aphrody awesome search "<term>"` (presets below).
5. Licenses: Apache-2.0 / MIT / BSD for linked code; GPL/AGPL only behind a process boundary.

## Matrix: need → Aphrody owner → upstream

| Need | Aphrody owner (crate / command) | Upstream it consumes or tracks | Newest channel (verified 2026-09-26) | Stable fallback |
| --- | --- | --- | --- | --- |
| Local GGUF inference | `crates/ai/llama-server` (supervises llama.cpp `llama-server` as an external binary, never linked); C ABI bridge in `aphrody-native` | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp/releases) | build tags `bNNNN`, newest `b11191` (pre-release, 2026-09-25) | latest non-pre-release on the same page |
| Local ONNX inference | `crates/ai/infer` (CUDA/DirectML/CPU) | [pykeio/ort](https://github.com/pykeio/ort/releases) | `v2.0.0-rc.13` | same (no 2.0 final yet) |
| Pure-Rust inference / tensors | reference only, behind `aphrody-infer`/`aphrody-llama-server` | [candle](https://crates.io/crates/candle-core), [mistral.rs](https://github.com/EricLBuehler/mistral.rs/releases), [burn](https://github.com/tracel-ai/burn/releases) | candle git `main`; mistral.rs `v0.9.4` (crates.io `mistralrs` 0.8.1); burn `v0.22.0-pre.4` | candle `0.11.0`; burn `0.21.0` |
| Server inference (GPU hosts) | served behind `aphrody-infra` catalog, consumed by `aphrody-ai` model clients | [vLLM](https://github.com/vllm-project/vllm/releases), [SGLang](https://github.com/sgl-project/sglang/releases) | vLLM nightly wheels ([docs](https://docs.vllm.ai/en/latest/getting_started/installation/)); SGLang `main` | vLLM `v0.30.0`; SGLang `v0.5.20` |
| Model catalog / download | `crates/ai/models` | [Hugging Face Hub](https://huggingface.co/models) | HF `sort=createdAt` per org | pinned digest in the catalog |
| Agent loop / runtime | `crates/ai/engine`, `aphrody-agent-runtime`, `aphrody-agent-tools`; `aphrody app-server` | reference: [rig](https://github.com/0xPlaygrounds/rig/releases) (`v0.42.0`) for ideas only | — | — |
| Sandbox / exec policy | `crates/os/kernel/core/src/execpolicy`, supervised by `aphrody-kernel`; Linux landlock/seccomp through `bun:linux` (Bun fork) | reference: Firecracker, E2B (third-party cloud, not used) | — | — |
| Agent protocols | `crates/contracts/a2a*` (A2A), `aphrody-ai/crates/aphrody-mcp` + `aphrody mcp` | [rmcp](https://crates.io/crates/rmcp) | rmcp git `main` | `3.4.1` |
| Embeddings | `crates/ai/embed` (fastembed/ONNX) | [fastembed-rs](https://github.com/Anush008/fastembed-rs/releases); models [Qwen3-Embedding](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF), [Qwen3-VL-Embedding](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B), [embeddinggemma-300m](https://huggingface.co/google/embeddinggemma-300m) | fastembed `v7.1.0` | same |
| RAG / rerank | `crates/ai/rag`, `aphrody-rag-core`, `aphrody-rag-eval`; `aphrody rag` | [Qwen3-Reranker](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B), [Qwen3-VL-Reranker](https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B); vector stores [lancedb](https://github.com/lancedb/lancedb/releases) `v0.39.0`, [qdrant-client](https://github.com/qdrant/rust-client/releases) `v1.19.0` (only if the in-tree store is outgrown) | — | — |
| Tokenizers | used by `aphrody-infer` / `aphrody-embed` | [tokenizers](https://github.com/huggingface/tokenizers/releases), [tiktoken-rs](https://crates.io/crates/tiktoken-rs) | tokenizers `v0.23.2`; tiktoken-rs `0.12.1` | same |
| OCR / vision | `crates/ai/ocr*`, `aphrody-vision`; `aphrody ocr` | GGUF VLMs via llama.cpp; e.g. [Qwen3-VL](https://huggingface.co/Qwen/Qwen3-VL-235B-A22B-Thinking-GGUF) | HF newest per org | pinned in `aphrody-models` |
| Speech (STT/TTS) | `crates/ai/voice` (`local-whisper` feature) | [whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases) `v1.9.4`; models [Qwen3-ASR](https://huggingface.co/Qwen/Qwen3-ASR-1.7B), [Voxtral-Mini-4B-Realtime](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602), [whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) (fallback) | whisper.cpp `master` | `v1.9.4` |
| Training / fine-tuning | `crates/ai/train` + `aphrody-ai/py/aphrody-train` (uv); `aphrody train` | [unsloth](https://github.com/unslothai/unsloth/releases), [TRL](https://github.com/huggingface/trl/releases) | unsloth `v0.1.815-beta`; TRL `main` | TRL `v1.14.0` |
| Python tooling | `aphrody-ai/py/` uv workspace | [uv](https://github.com/astral-sh/uv/releases) | `0.12.19` | same |
| UI / chat | `aphrody-ui` Tauri desktop + Material 3 (`@aphrody/m3`); talks to `aphrody app-server` over stdio JSON-RPC | reference only: Open WebUI, LibreChat, LobeChat (not deployed) | — | — |

## Frontier open-weight models (Hugging Face, newest first per org, 2026-09-26)

Pick per task through `aphrody-models`; licenses differ per model, read the model card.

| Family | Newest seen | Source |
| --- | --- | --- |
| Qwen | Qwen3.8 (`Qwen3.8-27B`, `Qwen3.8-Flash-Next`, `Qwen3.8-2.4T-A95B`) | https://huggingface.co/Qwen |
| DeepSeek | DeepSeek-V4.1-Flash, DeepSeek-V4-Pro-0813 | https://huggingface.co/deepseek-ai |
| Gemma | Gemma 4 (`gemma-4-E2B/E4B/12B/31B-it`, QAT GGUF) | https://huggingface.co/google |
| Mistral | Mistral-Medium-3.5-128B, Mistral-Small-4-119B-2603, Mistral-Large-3-675B-2512 | https://huggingface.co/mistralai |
| OpenAI open weights | gpt-oss-20b / gpt-oss-120b | https://huggingface.co/openai |
| Llama | Llama 4 Scout / Maverick (no newer Meta release on HF) | https://huggingface.co/meta-llama |

## Awesome presets (`aphrody awesome fetch <preset>`)

Defined in `crates/infra/git/src/awesome.rs`; each checked with `gh api repos/<repo>`
(exists, not archived, default branch) on 2026-09-26.

| Preset | Repository | Branch |
| --- | --- | --- |
| `awesome` | sindresorhus/awesome | main |
| `bun` | oven-sh/awesome-bun | main |
| `rust` | rust-unofficial/awesome-rust | main |
| `tauri` | tauri-apps/awesome-tauri | dev |
| `llm` | Hannibal046/Awesome-LLM | main |
| `open-llms` | eugeneyan/open-llms (last push 2025-02; model list is stale, prefer the table above) | main |
| `inference` | xlite-dev/Awesome-LLM-Inference | main |
| `agents` | e2b-dev/awesome-ai-agents | main |
| `coding` | jamesmurdza/awesome-ai-devtools | main |
| `mlops` | EthicalML/awesome-production-machine-learning | master |
| `rust-ml` | e-tornike/best-of-ml-rust | main |
