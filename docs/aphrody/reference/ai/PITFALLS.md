> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Pitfalls

Measured traps that cost real time in this codebase. Each entry states the
symptom, the cause and the remedy. Entries were carried over from the former
`aphrody` monorepo guide when they still apply to the crates that live here;
entries about code now owned by a sibling repository belong in that
repository's docs.

## Build and toolchain

- **sccache.** Always build with `RUSTC_WRAPPER=` (empty). sccache exits with
  code 2 under concurrent load (`sccache … clippy-driver … -vV (exit code: 2)`)
  when several agents share a target directory; that is not a code error. The
  repository has no `.cargo/config.toml`, so nothing re-enables it.
- **Sibling repositories move `Cargo.lock`.** Sibling crates inherit their own
  workspace dependencies, so a dependency bump committed in `../aphrody-shell`
  (or an uncommitted edit in any sibling checkout) rewrites this repository's
  `Cargo.lock` on the next build. Commit a lockfile produced against the
  siblings' pushed `main`, never against a sibling's uncommitted work. CI does
  not pass `--locked` for the same reason.
- **A sibling checkout mid-edit breaks the build here.** If `cargo` fails
  inside `../aphrody-*`, check `git -C ../aphrody-<x> status` before touching
  this repository: another agent may be halfway through a change.
- **`ort` with `default-features = false` needs `api-24`.** Without it
  `ort-sys` falls back to API 17 and `ort`'s execution-provider modules stop
  compiling (`E0609: no field SessionOptionsAppendExecutionProvider_VitisAI`).
  The workspace declaration is `features = ["std", "api-24", "ndarray", "tracing"]`.
- **aws-lc-sys on MSVC** needs NASM on `PATH` (CI installs it with
  `ilammy/setup-nasm`).
- **rustls 0.23 needs an installed crypto provider.** With `rustls-no-provider`,
  building a `reqwest::Client` before
  `rustls::crypto::ring::default_provider().install_default()` panics
  ("No provider set"). Binaries install it at startup; libraries use the shared
  client factory `aphrody_messaging::http_client`; tests use a `static ONCE:
  Once` helper with `rustls` as a dev-dependency.
- **rustls-only must be verified for the Linux target.** On Windows,
  `native-tls` goes through schannel, so `cargo tree -i openssl-sys` shows
  nothing while the Linux binary links OpenSSL. Correct check:
  `cargo tree --workspace --target x86_64-unknown-linux-gnu -e normal -i openssl-sys`
  must answer "did not match any packages".
- **Pinned versions.** `tracing-subscriber` stays at `=0.3.22` (0.3.23+ has a
  packaging bug); `rand` stays at 0.8 (imposed by `denokv_proto`).
- **wasm32.** `tokio` needs selective features there (`tokio-stream`,
  `js-sys`, `wasm-bindgen-futures`); `wasm-bindgen` is pinned exactly and must
  match `wasm-bindgen-cli`.
- **`pyo3` needs a real Python interpreter.** On Windows, `python` on `PATH`
  may be the Microsoft Store stub. Point the build at the uv interpreter:
  `PYO3_PYTHON="$(uv python find 3.14)"`.
- **The crate named `aphrody`** is the CLI; select it with `-p aphrody` (its
  directory is `crates/infra/aphrody`).
- **Build profiles are all in use.** `dist` and `reproducible` inherit from
  `release`; switching `release` to thin LTO degrades them. For a fast
  optimized build use `--profile release-fast`.
- **Linux verification from a Windows host.** Use the local Docker container
  `aphrody/build-linux:26.04` (Ubuntu 26.04, glibc 2.43; Dockerfile
  [linux.Dockerfile](https://github.com/aphrody-labs/bun/blob/main/scripts/aphrody/linux.Dockerfile) in the Bun fork), e.g.
  `bun C:/src/bun/scripts/aphrody/tmux.ts run <job> --linux --cwd C:/src/aphrody -- "<cmd>"`
  (`--cpus 6 --memory 6g`, never the VPS). Keep a named volume for `CARGO_TARGET_DIR`
  so Linux artifacts never mix with the Windows target directory.

## Features and wiring

- **Opt-in features are not covered by the default gates.** `ocr`, `infer`,
  `magika`, `forensics`, `index`, `firefly` are outside `default`, so a green
  `cargo clippy --workspace` says nothing about them. After touching a gated
  module run `cargo check -p aphrody --features "ocr,infer,index,forensics,firefly"`,
  `cargo clippy -p aphrody --features jobs` and
  `cargo clippy -p aphrody-mcp --features toolbox`.
- **A binary rebuilt without its features loses subcommands silently.** An
  `aphrody` built without `ocr` has no `aphrody ocr`; clap does not report an
  unknown subcommand, the argv falls through to the A2A `auto_command`
  fallback and fails with a connection error to the A2A endpoint. Check that
  `aphrody ocr` lists `page/audit/clean/batch` after a rebuild.
- **`#[tool_router]` (rmcp) ignores `#[cfg]` on `#[tool]` methods.** A tool
  compiled out leaves a dangling route (`E0599` on `Self::<name>_tool_attr`).
  Use one `impl` block per feature, gated on the item, each with its own
  `#[tool_router(router = <name>_router)]`, merged with `+=` into a single
  `all_tools()` passed to `#[tool_handler(router = Self::all_tools())]`.
- **A tool that compiles is not a tool that is wired.** Crates can compile and
  pass tests while nothing calls the new code. For every new surface,
  `grep -rn "<Symbol>" --include=*.rs crates/` outside its own file must return
  a line, and a test must lock the wiring (registry tool count, prompt order).
  A 1-2 s `cargo check` is a cache no-op, not proof.

## Inference and models

- **ONNX Runtime GPU is platform-specific at load time.** Runtimes live under
  `~/.aphrody/runtimes/` and are found by `aphrody_infer::runtime::discover()`;
  `download-binaries` stays disabled. The Windows CUDA 13 build imports
  `cublas64_13.dll` and `cublasLt64_13.dll` without cuDNN; that DLL note does
  not describe Linux. Linux CUDA packages need the matching CUDA libraries and
  cuDNN 9 reachable through the dynamic loader (`LD_LIBRARY_PATH`).
- **Linux CUDA libraries are not staged by `prepare_cuda`.** That helper is a
  Windows-only workaround for DLL search behavior. On Linux, keep the CUDA and
  cuDNN `lib` directories in the process loader path; verify the selected
  runtime with `aphrody infer runtime --json` and verify a real model with
  `aphrody infer probe <model> --require cuda` so a CPU fallback is not
  mistaken for GPU execution.
- **`ort` silently falls back to the CPU** when an execution provider fails to
  register. `aphrody-infer` registers CUDA/DirectML with `error_on_failure`, and
  `runtime::prepare_cuda` hard-links `cublas64_N` / `cublasLt64_N` /
  `cudart64_N` next to the runtime. Adding DirectML to the fastembed chain
  (`aphrody-embed`) crashes the process on the CUDA build, so it is opt-in
  (`APHRODY_EMBED_DIRECTML=1`).
- **llama.cpp is driven, not linked.** `aphrody-infer::llama` resolves upstream
  release binaries (`$APHRODY_LLAMA_BIN` > `$APHRODY_LLAMA_DIR` >
  `~/.aphrody/runtimes/llama-*` > `PATH`).
- **`llama-server` flags come from the installed build's `--help`**
  (`ServerCapabilities::probe`); the flag set changes every few builds. Real-GPU
  test: `APHRODY_LLAMA_BIN=… APHRODY_LLAMA_TEST_MODEL=… cargo test -p
  aphrody-llama-server --test real_server -- --ignored --nocapture`; supervisor
  integration tests need `--features test-support`.
- **`PR_SET_PDEATHSIG` is bound to the spawning thread.** A child spawned from
  a tokio blocking-pool thread dies when that worker retires. `aphrody-proc`
  makes it opt-in and the llama daemon spawns from its main thread. A daemon
  that exits before its parent stays a zombie and still answers the signal-0
  liveness probe; `spawn_detached` reaps it.
- **Exclusive `GpuLease` for training.** Training takes `LeaseKind::Training`
  to pause shared inference and avoid VRAM exhaustion on 12 GB GPUs.

## Agent engine and providers

- **`base_url` of a Codex-style provider already contains `/v1`**;
  `OpenAiCompatClient` appends only `/chat/completions` or `/responses`, while
  the legacy `LocalChatCompletionsClient::new` / `LocalResponsesClient::new`
  add `/v1` themselves. Mixing them yields `/v1/v1/…` 404s.
- **Pair tool calls by call id, never by name.** One model response is one
  model message (reasoning, text, calls in order); its results are one tool
  message. An unanswered call (interrupt, abort) still needs an error response
  or the next request is invalid.
- **Libraries never write into the user's home by default.**
  `RuntimeConfig::default()` records no rollout; user-facing surfaces opt in
  with `with_default_rollout_dir()` (`APHRODY_NO_ROLLOUT` opts out).
- **App-server v2 frames omit `jsonrpc` on the wire**, as the upstream Codex
  dialect does; only inputs tolerate it.
- **Never write to `~/.codex/auth.json`.** It is read as a keyless consumer
  only; no refresh grants against it.
- **Antigravity refresh is keyless.** The Antigravity desktop app maintains
  the OAuth token in the OS credential store; `AntigravityClient::refresh_token`
  re-reads it. A standalone OAuth refresh is attempted only when
  `APHRODY_ANTIGRAVITY_OAUTH_CLIENT_SECRET` (or `ANTIGRAVITY_OAUTH_CLIENT_SECRET`)
  is set. A 401 is fixed by logging in with `agy`, not in code.
- **Antigravity gates consumer accounts on client identity.** Requests must
  carry the `antigravity/cli/<ver> (aidev_client; …)` User-Agent
  (`antigravity_user_agent()`) and `loadCodeAssist` must send
  `{"metadata":{"ideType":"ANTIGRAVITY"}}` (`load_code_assist_metadata()`);
  otherwise `models`/`chat` return `UNSUPPORTED_CLIENT` / 403. Bump
  `ANTIGRAVITY_CLI_VERSION` together with the pinned `agy`.
- **`aphrody gemini` is a deprecated alias** that forwards to `agy` unless an
  explicit `APHRODY_GEMINI_BIN` is set; prefer `aphrody agy`.
- **`aphrody agy` provisions `~/.gemini/`** idempotently before forwarding
  (MCP server entry, skills, persona block); skip with
  `APHRODY_AGY_NO_PROVISION`. It never writes into the repository.
- **`aphrody doctor` requires `ai.json` and `.well-known/ai.json`** at the
  repository root; without them it reports `UNHEALTHY` (exit 1).
- **Web traps measured by the MCP tools.** Google serves the desktop Chrome
  agent a JavaScript-only SERP shell (0 results), so `aphrody_search` asks for
  the script-free HTML SERP first; `gemini.google.com` resets HTTP/2 streams
  (`PROTOCOL_ERROR`), so its clients are pinned to HTTP/1.1.

## RAG and data

- **Chunk sizes are UTF-16 units, like JavaScript.** Shenron's
  `maxChunkChars = 1400` counts JS string length; `aphrody-rag-core` measures
  `LengthUnit::Utf16` by default and `ChunkOptions::shenron_parity()`
  reproduces Shenron exactly for the parity goldens.
- **Embedding spaces never mix.** Vectors from `multilingual-e5-small` cannot
  be compared with another model's; re-index or isolate by `model_id`.
- **Evaluation gold sets stay disjoint from training data.** Generated
  training triples are checked against `rag-gold.jsonl` hashes.
- **The Shenron production database host is read-only for this repository.**
  Its disk is nearly full: replicate SQLite databases locally for evaluation
  and never write benchmarks, logs or indexes there.
- **A discovery filter stricter than the correction filter hides results
  silently.** When discarding candidates, count and log what is discarded; a
  detector annotates, it does not filter. A correction rule with a high
  false-positive rate is worse than the defect it fixes: ship every corrected
  family with its measured count, the counter-example searched and a
  regression test.

## Python and Bun

- **`py/aphrody` is both the uv member directory and the package parent.**
  `py/pyproject.toml` sets `[tool.pytest.ini_options] pythonpath = ["aphrody"]`
  so `uv run pytest` from `py/` imports the real package.
- **`await 0` is not a useless `await`.** oxlint flags it, but it yields to the
  microtask queue; replacing it with `0;` changes behavior. Suppress the lint
  locally instead.

## Working with other agents

- **One checkout, one git index.** Agents in the same checkout share
  `.git/index` (not in repo): whatever one stages, the other's next commit takes. Commit
  through a private index (`GIT_INDEX_FILE=.git/index-<agent>`,
  `git read-tree HEAD`, `git add <paths>`), and check `git diff -- <path>`
  first: a private index does not protect against a peer editing the same
  file.
- **Adding a workspace member rewrites `Cargo.lock` for every crate on disk**,
  including a peer's uncommitted crate. Commit a lock limited to your own
  crates, and write `src/lib.rs` before adding the member line.
- **Re-check `git log --oneline main..HEAD` before fast-forwarding**; peers
  commit on `main` concurrently.
- **Shell traps.** A pipe into `tail`/`head` masks the exit code (use
  `; echo "exit=$?"`). Git Bash heredocs choke on large quoted payloads: write
  the payload to a file and apply it with a small `bun` script.
