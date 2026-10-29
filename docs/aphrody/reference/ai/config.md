<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Configuration Guide (`config.toml`)

Aphrody uses a layered configuration system fully compatible with OpenAI Codex's `config.toml` format, while extending it with native configuration tables for local inference, RAG, training, computer use, and security policy.

## File Locations and Precedence

Configuration is resolved in the following order (highest precedence wins):

1. **CLI Flags and Dotted Overrides**: `-c key=value` (e.g. `-c rag.mode=lexical` or `-c model="qwen2.5-coder-7b"`), `--oss`, `--full-auto`.
2. **Profile Selection**: `-p <profile_name>` or `APHRODY_PROFILE=<profile_name>` selects `[profiles.<profile_name>]`.
3. **Workspace/Project Configuration**: `.aphrody/config.toml` located in current working directory or Git repository root.
4. **User Global Configuration**: `~/.aphrody/config.toml` (located in `$APHRODY_HOME` or OS state dir).
5. **Codex Home Import (Opt-in)**: `~/.codex/config.toml` when opted into via `[compat] read_codex_home = true` or `aphrody config import-codex`.
6. **Built-in System Defaults**: Zero-HITL defaults (`approval_policy = "never"`, `sandbox_mode = "workspace-write"`).

---

## Canonical `config.toml` Schema

```toml
# ==============================================================================
# General & Model Configuration
# ==============================================================================

# Default model identifier
model = "qwen3-30b-a3b-instruct-2507-q4km"

# Model provider: "llama", "antigravity", "ollama", "lmstudio", "vllm", "openai", "anthropic", or "chatgpt"
model_provider = "llama"

model_context_window = 32768
model_auto_compact_token_limit = 24576

# Autonomous Execution & Approval Policy (Doctrine: No Human in the loop)
# Options: "never" (default), "on-request", "on-failure", "untrusted"
approval_policy = "never"

# Execution Sandbox Mode
# Options: "workspace-write" (default), "read-only", "danger-full-access"
sandbox_mode = "workspace-write"

# ==============================================================================
# Model Providers (`[model_providers.<name>]`)
# ==============================================================================

[model_providers.llama]
name = "Managed llama-server"
# No base_url here on purpose: a managed provider's endpoint is resolved at
# runtime by the aphrody-llama-server supervisor once it has picked a free
# loopback port (never a fixed literal — CLAUDE.md §7). Read the currently
# bound endpoint with `aphrody ai env` (APHRODY_AI_CHAT_BASE_URL).
wire_api = "chat"
managed = "llama-server"

[model_providers.ollama]
name = "Local Ollama"
base_url = "http://127.0.0.1:11434/v1"
wire_api = "chat"

[model_providers.antigravity]
name = "Google Antigravity / Cloud Code"
wire_api = "antigravity"

[model_providers.openai]
name = "OpenAI Platform"
base_url = "https://api.openai.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"

# ==============================================================================
# Retrieval-Augmented Generation (`[rag]`)
# ==============================================================================
#
# Every field below is only the fallback: `embed_model`, `embed_backend`,
# `vector_dim`, `embed_endpoint`, `rerank_model` and `rerank_endpoint` are all
# resolved through one function, `aphrody_rag::resolve_embed` /
# `resolve_rerank` (crates/aphrody-rag/src/config_resolve.rs) — the CLI
# (`aphrody rag`), the `aphrody_rag_*` MCP tools, the agent runtime and the
# app-server all call it. Precedence: the canonical `APHRODY_AI_EMBED_*` /
# `APHRODY_AI_RERANK_*` environment variable (see "The canonical
# `APHRODY_AI_*` environment" below), then its legacy aliases
# (`EMBED_URL`, `APHRODY_RAG_EMBED_DIM`, ...),
# then the values below, then the local model catalog's default
# (`aphrody_models::LocalRole::Embed` / `LocalRole::Rerank`). An explicit
# `APHRODY_AI_EMBED_DIMENSIONS` that disagrees with the catalog's dimension
# for the resolved model is an error, never a silent choice: embedding spaces
# must never mix.

[rag]
# Retrieval mode: "hybrid+rerank" (default), "hybrid", or "lexical"
mode = "hybrid+rerank"

# Embedding model in catalog or local path. `embed_backend = "ort"` runs
# in-process (aphrody-embed's own small whitelist: bge-small-en-v1.5,
# all-minilm-l6-v2); `"llama-server"` and `"openai-compat"` call
# `embed_endpoint` and need vector_dim to match the model actually served
# there.
embed_model = "multilingual-e5-small"
embed_backend = "ort"
vector_dim = 384

# Optional non-secret HTTP endpoints. Credentials remain in environment
# variables (APHRODY_RAG_API_KEY), never here. Leave unset to resolve from
# APHRODY_AI_EMBED_BASE_URL / APHRODY_AI_RERANK_BASE_URL instead.
# embed_endpoint = "http://127.0.0.1:8081/v1/embeddings"
# rerank_endpoint = "http://127.0.0.1:8082/rerank"

# Reranker model in catalog or local path
rerank_model = "bge-reranker-base"

# Candidate limits
top_k = 20
rerank_top_n = 5

# Local SQLite index storage path (relative to the active profile's state
# directory — the CLI resolves `~` and relative paths through
# aphrody_models::paths).
db_path = "rag/index.db"

# ==============================================================================
# Managed Local Inference Supervisor (`[llama]`)
# ==============================================================================

[llama]
# How long an idle managed instance stays resident before the supervisor
# shuts it down. A duration string ("5m", "1h"), not seconds.
keep_alive = "15m"

# Context size in tokens, passed to `llama-server --ctx-size`.
ctx = 32768

# Optional LoRA adapter (GGUF), loaded without applying for hot-swap via
# POST /lora-adapters.
# lora = "~/.aphrody/models/adapters/my-lora.gguf"

# Extra raw arguments appended verbatim to the llama-server command line.
# extra_args = ["--flash-attn", "on"]

# Directory searched for the llama-server binary before PATH.
# runtime_dir = "~/.aphrody/runtimes/llama-cuda13"
#
# There is no port here — ports are dynamic and chosen by the supervisor
# per launch, never written into `config.toml` (CLAUDE.md §7,
# "forbidden": "hard-coded-dynamic-port"). GPU offload placement is decided
# per launch by `aphrody-llama-server`'s planner (`--fit` when the installed
# build supports it, a computed layer split otherwise) from the model's own
# GGUF metadata and the free VRAM probed at launch time — not a config key.

# ==============================================================================
# Training Surface (`[train]`)
# ==============================================================================

[train]
# The shared Aphrody Python workspace; also settable with APHRODY_PY_ROOT.
# python_project = "py"

# Directory where trained artifacts (ONNX, GGUF, event logs) are written.
# output_dir = "~/.aphrody/train/output"
#
# That is the whole schema (feature `train`, `aphrody-train` crate): the
# promotion gate (evaluation delta thresholds, per-tag regression budgets),
# the exclusive GPU lease timeout, and the base model are runtime/CLI
# concerns, not `config.toml` keys — see `aphrody train --help` and
# `docs/plans/codex-oss.md` P10.

# ==============================================================================
# Computer Use & UI Automation (`[computer_use]`, feature `computer-use`)
# ==============================================================================

[computer_use]
# Master on/off switch.
enabled = true

# Application allow-list. A non-empty list denies every app not in it — the
# no-approval replacement for Codex's per-app human confirmation.
allowed_apps = ["notepad", "calc", "browser", "code"]

# Application deny-list, always enforced regardless of allowed_apps.
denied_apps = ["regedit", "cmd", "powershell", "terminal", "taskmgr"]

# Target backend: "windows" (native desktop automation via winclean),
# "browser" (bxc's browser_* tools), or "linux" (x11rb).
environment = "windows"

# ==============================================================================
# Isolated Home Agent Profiles (`[profiles.<name>]`)
# ==============================================================================

[profiles.example]
plugins = ["~/src/aphrody-ai/plugins/aphrody"]

[profiles.example.database]
db_type = "postgres"
url_env = "DATABASE_URL"
schema = "example"
cache = "sqlite_wal"
cache_path = "workspace-example/cache.sqlite3"

[profiles.example.rag]
db_path = "workspace-example/rag/index.db"
embed_backend = "ort"
embed_model = "multilingual-e5-small"
mode = "hybrid+rerank"
rerank_model = "bge-reranker-base"
vector_dim = 384

[profiles.example.skills]
whitelist = ["rag.canon", "ocr.continuous"]

[profiles.example.a2a]
id = "example@aphrody.com"
mailbox = ".coord/inbox-from-example.jsonl"

[profiles.example.ocr]
engines = ["ppocr-v5-mobile", "dots-ocr"]
state_path = "workspace-example/ocr"

[profiles.example.redis]
url = "redis://127.0.0.1:6379/1"
prefix = "example:"

# When a profile supplies one of the eight Home Agent components above, that
# component replaces the root value atomically. Paths, MCP servers, skill
# allowlists, A2A mailboxes, OCR state and Redis namespaces cannot leak from
# another component or an unselected profile.

# ==============================================================================
# Switching model + provider together (`[profiles.<name>]`)
# ==============================================================================
#
# `[profiles.<name>]` (`ConfigProfile`, above) is the switch for "run this
# model on this provider": `-p fast` merges a named profile onto the root
# config, later than the plain root-level settings but earlier than `-c`
# overrides and CLI flags. It shares its shape with `[profiles.example]`
# above (model, model_provider, approval_policy, sandbox_mode, rag, database,
# plugins, skills, mcp_servers, a2a, ocr, redis, wire_api — there is no
# `model_temperature` field anywhere in this schema; sampling temperature is
# a request-time concern of the model client, not `config.toml`).

[profiles.fast]
model = "qwen3-4b-instruct-2507-q4km"
model_provider = "llama"

[profiles.quality]
model = "qwen3-coder-30b-a3b-q4km"
model_provider = "llama"

[profiles.vision]
model = "qwen3-vl-8b-instruct-q4km"
model_provider = "llama"
```

## Per-model prompt dialect (`[model_profiles.<id>]`)

`[model_profiles.<id>]` is a *different* table from `[profiles.<name>]`
above, despite the similar name: it is opaque to `aphrody-config` and owned
by `aphrody-toolcall-repair`'s `PromptProfile` — which tool-call dialect and
`apply_patch` format a given open-weight model family actually emits, the
harness preamble that keeps it inside that dialect, whether it can be
trusted with parallel tool calls, an optional cap on tools exposed at once,
a constrained-decoding strategy (`none` | `json_schema` | `gbnf`), a
suggested sampling `temperature`, and stop sequences. aphrody ships built-in
profiles for the model families it targets (Qwen2.5-Coder, Qwen3, GPT-OSS,
...); `[model_profiles.<id>]` only needs an entry to override or add one.

## The canonical `APHRODY_AI_*` environment

`[rag]`'s embedder/reranker, the managed `llama-server` provider's base URL,
and the OCR/STT/vision model ids are not only `config.toml` keys: they are
also named by eighteen canonical environment variables
([`aphrody_config::ai_env`](../../../crates/ai/config/src/ai_env.rs)), the
same contract `[`tools/config/local-ai.json`](../../../../tools/aphrody/config/local-ai.json)` publishes to
`aphrody-os` and `nie`:

| Canonical name | What it names |
| --- | --- |
| `APHRODY_BIN` | The `aphrody` executable. |
| `APHRODY_AI_MCP_BIN` | The `aphrody-mcp` executable. |
| `APHRODY_AI_HTTP_URL` / `_TOKEN` | The `aphrody-ai-http` REST gateway (vps only). |
| `APHRODY_AI_CHAT_BASE_URL` / `_MODEL` | The managed chat instance. |
| `APHRODY_AI_CODE_MODEL` / `_REASONING_MODEL` / `_SMALL_MODEL` | Same instance, different model. |
| `APHRODY_AI_VISION_BASE_URL` / `_MODEL` | Visual transcription. |
| `APHRODY_AI_OCR_MODEL` | `aphrody ocr`'s default VLM engine. |
| `APHRODY_AI_STT_MODEL` | `aphrody_transcribe`'s default model. |
| `APHRODY_AI_EMBED_BASE_URL` / `_MODEL` / `_DIMENSIONS` | The `[rag]` embedder. |
| `APHRODY_AI_RERANK_BASE_URL` / `_MODEL` | The `[rag]` reranker. |

Every reader resolves the canonical name first, then each documented legacy
alias (`EMBED_URL`, `APHRODY_RAG_EMBED_DIM`,
...) in order, then falls back to the value above, then to the local model
catalog's default. **`aphrody ai env`** is the one writer: it resolves this
machine's current values (the llama-server URL/port a managed instance is
actually bound to right now, the per-role model ids, the `aphrody` /
`aphrody-mcp` binaries reachable from this process) and writes
`~/.aphrody/ai/local-ai.json` and `~/.aphrody/ai/local-ai.env`. Run
`aphrody ai env --print --format env|json|nu|pwsh` to also print them; it
never writes a secret value (`APHRODY_AI_HTTP_TOKEN` is emitted only as a
reference to where it lives).
