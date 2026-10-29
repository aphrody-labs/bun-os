<!-- SPDX-License-Identifier: Apache-2.0 -->
# Local chat for desktop applications

The contract an application uses to ship a local chat model, a chat
router and a local memory, through the `aphrody` binary it already carries. Every command prints
one JSON object per line on stdout; diagnostics go to stderr. Owners: `aphrody-llama-server`
(`local_chat`, `router`, `chat_cli`), `aphrody-models` (catalog, store), `aphrody-memory`
(`local_ops`), wired by `aphrody-command`. Windows x64 and Linux x64 use the same commands;
`llama-server` is the upstream llama.cpp binary, driven and never linked.

## Model provisioning

```sh
aphrody llama provision --home <dir> \
  [--catalog product-catalog.json] [--model <spec> [--model-sha256 <hex>]] \
  [--lora <spec> [--lora-sha256 <hex>] [--lora-scale <f>]]... [--force]
```

- `--home <dir>`: models go to the store `<dir>/models` (`registry.json` with digests), server
  state to `<dir>/llama`. `--models-dir` and `--state-dir` set them separately.
- `<spec>` is a catalog id or a reference: `hf:owner/repo/file@<commit>`, `https://…`, or
  `file:/path` (an installer-shipped file, used in place, never copied).
- Catalog ids resolve in the `--catalog` file first (the `catalog.json` schema of
  `aphrody-models`, read by `Catalog::load`), then in the built-in catalog. The base default is
  `qwen3-4b-instruct-2507-q4km` (Hub commit `a06e946b…`, sha256 `3605803b…`). A product declares
  what it owns, such as a fine-tuned adapter, in its own catalog, with a file role `lora`.
- Each file is checked against its SHA-256: catalog digests, `--*-sha256` for raw references. A
  `file:` reference is hashed before use. An interrupted download resumes.
- Output: `{"event":"progress","role","spec","downloaded","total"}` lines (about every percent),
  then `{"event":"provisioned","model_id","weights","lora":[{"path","scale"}],"artifacts":[…]}`,
  or `{"event":"error","message"}` with exit status 1.

## One chat server

```sh
aphrody llama serve --home <dir> [model options] [--llama-bin <file|dir>] [--ctx 8192] \
  [--parallel 1] [--alias <name>] [--ready-timeout 180] [--keep-alive <s>] \
  [--detach | --parent-pid <pid> | --exit-on-stdin-eof] [-- <llama-server args>]
aphrody llama status --home <dir>
aphrody llama stop --home <dir>
```

- `serve` provisions the model, finds `llama-server` (`--llama-bin`, `APHRODY_LLAMA_BIN`,
  `APHRODY_LLAMA_DIR`, then `llama-server`, `bin/` or `llama/` beside the `aphrody` executable,
  the newest `~/.aphrody/runtimes/llama-*`, then `PATH`), plans the launch for the machine
  (context, KV precision, `--fit` GPU placement) and starts the supervised daemon.
- Adapters are loaded inactive (`--lora … --lora-init-without-apply`), then given their scale
  once the server is up. `ready` reports what the server applies (`GET /lora-adapters`).
- `{"event":"ready","base_url":"http://127.0.0.1:<port>/v1","server_url","health_url","model",
  "port","attached","binary","ctx","lora":[{"id","path","scale"}],"notes"}`.
- In the foreground (the default), the command touches the lease and stops the server when the
  `--parent-pid` process exits, when stdin closes (`--exit-on-stdin-eof`, spawn it with a piped
  stdin), or on Ctrl-C or SIGTERM. Then it prints `{"event":"stopped","reason"}`. If it is killed
  outright, the server idles out after `--keep-alive` (120 s in the foreground). `--detach` returns
  after `ready` and leaves the daemon to its keep-alive (900 s by default, `0` for never).
- `status`: `{"event":"status","running","ready","health":"ready"|"loading"|{"down"},"base_url",
  "model","port","lora"}`.

## Router: one OpenAI endpoint over several models

```sh
aphrody llama router --home <dir> --config router.json [--bind 127.0.0.1:0] \
  [--llama-bin <file|dir>] [--parent-pid <pid> | --exit-on-stdin-eof]
```

```json
{
  "catalog": "/path/product-catalog.json",
  "models": [
    { "backend": "llama", "id": "product-chat-v2", "model": "qwen3-4b-instruct-2507-q4km",
      "lora": [{ "spec": "file:/app/models/product-chat-v2.gguf", "sha256": "aab48535…", "scale": 1.0 }],
      "ctx": 8192 },
    { "backend": "llama", "id": "gemma-4-e2b", "model": "gemma-4-e2b-it-q4km", "ctx": 8192 },
    { "backend": "gemini-web", "id": "gemini-web/flash", "variant": "flash", "language": "fr" },
    { "backend": "openai", "id": "remote", "base_url": "http://127.0.0.1:8080/v1",
      "upstream_model": "x", "api_key_env": "REMOTE_KEY" }
  ]
}
```

- Startup: `{"event":"listening","url","base_url":"…/v1","health_url","models":[ids]}`.
- `GET /v1/models` lists only the models that can answer now. A llama model qualifies when its
  files are in the store, which `provision` fills (the router never downloads during a listing),
  and `llama-server` was found. A Gemini model qualifies when its cookie session bootstraps (probe
  cached for 5 min). The jar is `cookie_file`, else `APHRODY_GOOGLE_COOKIES_JSON`, else
  `~/.aphrody/google-cookies.json`. An `openai` upstream qualifies when its `/models` answers.
- `GET /health`: `{"status":"ok"|"unavailable","backends":[{"id","backend","available",
  "running","reason"}]}`.
- `POST /v1/chat/completions` routes on `model`:
  - llama: the model starts on first use (one at a time: switching stops the previous one, each
    keeps its state in `<state-dir>/<id>`, idle shutdown after 10 min). The body is relayed
    unchanged, including `stream`, `tools`, `tool_choice` and `response_format`. Tool calls are
    native: `llama-server --jinja` renders the model's own template and returns OpenAI
    `tool_calls`. Declare tools as standard OpenAI `tools` entries.
  - gemini-web: messages are flattened into one prompt, the answer comes back as one
    `chat.completion`, or as SSE (one delta, a `stop` chunk, `[DONE]`) when `stream: true`. It has
    no tool calling: `tools` are dropped and the response carries `x-aphrody-tools-ignored: true`.
  - openai: relayed as is, with `model` rewritten to `upstream_model`.
  - An unknown id returns 404 `model_not_found`. An unavailable backend returns 503
    `model_unavailable` with the reason.
- `POST /v1/responses` and `POST /v1/responses/compact` use the same model selection for
  llama and `openai` backends. `base_url` already includes `/v1`; the router appends
  `/responses` or `/responses/compact`. Bodies are relayed intact except for the configured
  `upstream_model` substitution: tools, call IDs, previous response IDs, opaque reasoning
  and compaction items, usage and SSE events stay native. Upstream errors retain their
  status and body, with request IDs and retry/rate-limit headers. A Gemini web model returns
  400 `unsupported_endpoint` without loading its cookie session.
- Responses and standalone compaction require the selected upstream to implement those
  endpoints. Routing a llama model does not add compaction to a runtime that lacks it;
  an upstream 404 remains 404. Pass the native compact response's `output` as the next
  Responses `input`, including the opaque compaction item
  ([OpenAI contract](https://developers.openai.com/api/docs/guides/compaction)).

## Memory

```sh
aphrody memory write  --db <file> --agent-id <id> --content <text|-> [--tag t]... [--metadata '{…}'] [--id <id>]
aphrody memory recall --db <file> --agent-id <id> --query <text> [--tag t]... [--limit 20]
aphrody memory list   --db <file> --agent-id <id> [--tag t]... [--limit 20]
aphrody memory delete --db <file> --id <id> [--agent-id <id>]
aphrody memory clear  --db <file> --agent-id <id>
```

- Storage is the `SqliteLocalProvider` file (`memory_records` table), created when absent, mode
  0600 on Unix. Without `--db`, the active profile's local memory database is used.
- Answers: `{"id"}`, `{"records":[{"id","agent_id","content","tags","created_at_unix_ms",
  "metadata"}]}` (recall adds `"score"` in `0..1`), `{"deleted":true|false}`, `{"deleted":n}`.
- Recall is lexical and needs no embedding model. It scores the share of query words found in
  each record; CJK characters count one by one, so Japanese queries match. Records with no shared
  word are dropped. The best matches come first, newest first among equals.
- Rust: `aphrody_memory::local_ops::{write, recall, list, delete, clear}` over any
  `&dyn MemoryProvider`.
