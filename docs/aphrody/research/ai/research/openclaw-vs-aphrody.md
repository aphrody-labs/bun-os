> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# OpenClaw vs aphrody — Comparative Audit

> Source transfer (2026-10-09): native RE now belongs to [bun-re in the pinned Bun fork](https://github.com/aphrody-labs/bun/tree/e4d57537cf3475e443eba9bda390366aa5d9d0a4/packages/bun-re). Removed Aphrody paths below describe the original integration layout; dated observations and measurements retain their original scope.

> Qualification du 2026-10-09 : les owners IA retirés du checkout sont signalés « not in repo ». Les constats datés ci-dessous ne prouvent pas leur présence ou leur fonctionnement actuel.

**Audit date:** 2026-05-23
**Correction 2026-10-05:** rows that cited the gateway `byok/` adapters now cite the live code. That module was never declared by the gateway crate (never compiled since its import in `827bf08a9`) and was removed.
**openclaw clone:** `var/openclaw` (not in repo) @ `4f0c9020` (`feat(diagnostics): trace gateway secret preparation (#83019)`)
**aphrody:** this repo (`C:\src\aphrody`), Rust-only, branch `main`
**Method:** on-disk verification only (`ls`/`grep`/`cat` real). No web claims.

## Framing

openclaw is a **TypeScript/Node, Apple- and OpenAI-centric** personal AI assistant
(macOS menu-bar app + iOS/Android nodes, OpenAI sponsor/OAuth, iMessage, ElevenLabs).
aphrody is the **Rust, Google-centric** cross-platform rework. The pivot is deliberate:
Apple-specific subsystems map to **Google equivalents**, and the provider/channel set is
intentionally narrowed to **Google + Anthropic** (providers) and **Discord + X** (channels).
This audit only flags a GAP when a *neutral* subsystem is missing, or when an Apple subsystem
has *no Google equivalent* in aphrody.

---

## 1. Providers (focus: Google + Anthropic only)

openclaw ships ~60 provider plugins under `extensions/` (openai, anthropic, anthropic-vertex,
google, amazon-bedrock, azure, mistral, groq, deepseek, xai, ollama, openrouter, vercel-ai-gateway,
litellm, …). Per the mission, aphrody keeps only Google + Anthropic; everything else is
out-of-scope-by-design, not a gap.

| Provider | openclaw | aphrody | Evidence (aphrody) | Improvement |
|----------|----------|---------|--------------------|-------------|
| **Google / Gemini** | `extensions/google`, `googlechat` | ✅ keyless OAuth + cookie + CLI + BYOK | `crates/google/gemini-runtime`, `gemini-web`, `antigravity-sdk`, `google_antigravity.rs`, `gemini_cli.rs` | Keyless: agy token (Credential Manager via antigravity-sdk), `gemini-web` cookie auth, Vertex/Cloud-Code OAuth, `gemini-cli` gated. Streaming SSE normalized. |
| **Anthropic / Claude** | `extensions/anthropic`, `anthropic-vertex` | ✅ Messages API streaming client | `crates/ai/model-client/src/anthropic.rs` | Native SSE streaming decoded into neutral stream events, `tool_use`/`tool_result` blocks, signed thinking replay. |
| Image gen | `comfy`, `fal`, `runway`, `image-generation-core` | ✅ Google Nano Banana Pro + Adobe Firefly | `crates/aphrody-images` (not in repo), `aphrody-firefly`, the `aphrody-bun` icons module, `aphrody-identity` logo; MCP `gemini_image`, `firefly_generate` | Nano Banana Pro (gemini-3-pro-image-preview, Vertex global) + Firefly S2S OAuth. |
| Video gen | `video-generation-core`, `runway` | ✅ Veo | MCP `gemini_video`; `cli/src/main.rs` veo refs | Google Veo via Gemini. |
| Deep research | (none first-class) | ✅ | MCP `gemini_deep_research`; `notebooklm/src/research.rs` | NotebookLM + Gemini deep-research — net-new capability. |
| LLM infra (cache/cost/retry/rate) | scattered | ✅ unified | `crates/aphrody-llm-infra/src/{cache,cost,retry,rateguard}.rs` | Consolidated latency/cost layer. |

**Provider verdict:** the two kept providers are present and **improved** (keyless auth, unified
streaming normalization, image=Nano Banana Pro, video=Veo, deep-research, dedicated llm-infra).
OpenAI/Bedrock/Mistral/etc. = **out-of-scope by design** (not gaps).

---

## 2. Channels (focus: Discord + X only)

openclaw supports ~24 channels (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal,
iMessage, IRC, Teams, Matrix, Feishu, LINE, Mattermost, Nostr, Twitch, WeChat, QQ, WebChat, …).
Mission keeps only Discord + X.

| Channel | openclaw | aphrody | Evidence |
|---------|----------|---------|----------|
| **Discord** | `extensions/discord`, `skills/discord` | ✅ | `crates/ai/messaging/src/channels/discord.rs` (not in repo) (retired source path; retained as historical evidence), `aphrody-voice/src/discord_shim.rs` (voice), hermes |
| **X (Twitter)** | (not a channel in openclaw) | ✅ net-new | `crates/aphrody-x-client` (not in repo) (158 GraphQL ops, cookie auth, no key), `aphrody-messaging/src/channels/x.rs`, hermes |

Aphrody additionally retains Slack/Telegram/Matrix connectors (`aphrody-messaging/src/channels/`)
as bonus, plus **hermes** (voice-to-voice multi-channel agent: Discord + X full-duplex) — beyond
openclaw's text inbox. Other channels (iMessage Apple, WhatsApp, Signal, …) = **out-of-focus**.

**Channel verdict:** both required channels present; X is a net-new capability vs openclaw.

---

## 3. Everything else (neutral subsystems + Apple→Google mapping)

| Subsystem | openclaw | Apple-specific? | aphrody equivalent | Evidence | Status |
|-----------|----------|-----------------|--------------------|----------|--------|
| Gateway / control plane | `src/gateway` | no | `crates/ai/gateway` | `cloudflare.rs`, `vercel.rs`, `lib.rs` | ✅ |
| Multi-agent routing | `src/routing` | no | `crates/ai/router` (not in repo) | `router/src/lib.rs` | ✅ |
| Sessions | `src/sessions` | no | `crates/ai/session` | `session/src/lib.rs` | ✅ |
| Memory / RAG | `extensions/memory-*`, `memory-lancedb`, `memory-wiki` | no | `crates/ai/memory` | `lancedb.rs`, `hnsw.rs`, `honcho.rs`/`honcho_v3.rs`, `mem0.rs`/`mem0_v3.rs`, `jsonl.rs`, `eviction.rs` | ✅ (richer: LanceDB + HNSW + Honcho/mem0 v3) |
| Skills | `skills/`, `src/skills` | no | `crates/ai/skills` (not in repo), `aphrody-skills-forge` | `skills/src/{lib,hooks,permissions}.rs`, `runtime/` | ✅ |
| Skills registry (ClawHub) | `skills/clawhub` | no | `crates/ai/marketplace` (not in repo) | `marketplace/src/awesome.rs` | ✅ |
| Hooks | `src/hooks` (gmail, message, plugin) | no | `aphrody-skills/src/hooks.rs`, `aphrody-events`, MCP `native_hooks` | `events/src/lib.rs` | ✅ (Gmail Pub/Sub hook = not ported, see GAPS) |
| Permissions / tool policy | `src/security/audit-tool-policy` | no | `aphrody-skills/src/permissions.rs`, `aphrody-tools/src/permissions.rs` | builtin tools | ✅ |
| Tools | `src/tools` (browser, canvas, cron, sessions) | no | `crates/ai/tools` (not in repo) | `tools/src/builtin` (not in repo), `aphrody-terminal-browser` | ✅ |
| MCP | `src/mcp` (channel/tools serve) | no | `crates/ai/mcp`→`aphrody-mcp` bin, `aphrody-mcp` (OAuth/PKCE) | `aphrody-mcp/src/{pkce,registration,discovery}.rs`, `google_mcp` | ✅ (50+ tools incl. OAuth flow) |
| Cron / scheduling | `src/cron` (large) | no | none (`aphrody-cron` removed 2026-10-09; `Bun.cron` in the Bun fork) | - | ⚠️ thin (see GAPS) |
| Auth / secrets | `src/secrets`, auth-profiles | no | `crates/os/ostd/secrets` | `secrets/src/lib.rs` | ✅ |
| Config | `src/config` | no | `crates/os/settings` (not in repo) | `settings/src/lib.rs` | ✅ |
| CLI / onboarding | `openclaw onboard/pairing/doctor` | no | `cli` `oc-onboard/oc-pairing/oc-reset/oc-uninstall/doctor` | `cli/src/oc_cmd.rs` (897 LOC) | ✅ (explicit openclaw-compat surface) |
| DM pairing / allowlist | `dmPolicy`, `pairing approve` | no | `oc-pairing` (`~/.aphrody/pairing.json`) | `cli/src/oc_cmd.rs:340-468` | ✅ |
| Sandbox (Docker/SSH/OpenShell) | `agents.defaults.sandbox` | no | `SandboxShell` | `aphrody-sdk/src/shell.rs:85-181`, `aphrody-sdk/src/fs.rs` | ⚠️ host shell sandbox only, no Docker/SSH backend (see GAPS) |
| Web / API surface | `ui/`, web RPC | no | `crates/ui/a2a-ui` (not in repo), `aphrody-gateway` HTTP, `tuono*` | `a2a-ui/src/native` | ✅ |
| Voice (TTS/STT) | `src/talk`, `elevenlabs`, mlx-tts | macOS TTS partly Apple | `crates/ai/voice` | `voice/src/{elevenlabs,web}.rs`, `stt/` | ✅ (ElevenLabs + STT; system TTS) |
| Realtime transcription | `src/realtime-transcription` | no | `aphrody-voice/src/stt` | stt module | ✅ |
| Observability / OTel | `extensions/diagnostics-otel/-prometheus` | no | none (`aphrody-telemetry` removed 2026-10-09, no consumer) | - | ❌ |
| Terminal | (none; uses host) | no | 8× `aphrody-terminal-*` | `aphrody-terminal-{vt,browser,llm,markdown,…}` | ✅ net-new (LLM-first terminal) |
| Reverse engineering / forensics | (none) | no | `crates/os/kernel/comps/re` (not in repo), `cli re/forensics/scan` | `aphrody-re/src/` | ✅ net-new |
| **Apple HIG / design** | macOS/iOS SwiftUI, Apple HIG | **Apple** | **Material Design 3 / M3 Expressive** | `crates/ui/m3-tokens` (hct, color, typography Google Sans, motion, shape, elevation, gemini_brand), `aphrody-design`, `mui-rs-components`, `aphrody-wgpu-material` | ✅ Google equivalent |
| **macOS menu-bar app** | `apps/macos` (not in repo) | **Apple** | M3 native UI (`mui-rs`, `gui`, `a2a-ui`) + cross-platform CLI | `crates/mui-rs*`, `gui` | ✅ Google/cross-plat equivalent |
| **iOS/Android nodes** | `apps/{ios,android}` | **Apple/mobile** | Android/Compose patterns via M3; `aphrody-react-reconciler` | `m3-tokens/src/adaptive.rs` | ✅ (Google/M3) |
| **Live Canvas / A2UI** | `apps/.../canvas` | partly Apple | `crates/ui/a2a-ui` (not in repo) + A2A protocol (`crates/a2a*`) | `a2a-ui/src/native`, `a2a-server`, `a2a-pb` | ✅ A2A-based equivalent |
| **iMessage** | `extensions/imessage` | **Apple** | n/a (Apple channel; Discord/X kept) | — | out-of-scope (Apple) |
| Link understanding | `src/link-understanding` | no | `aphrody-context`, `universal_web_fetch` MCP | `aphrody-context/src/lib.rs` | ✅ (web fetch + context) |
| Auto-reply loop | `src/auto-reply` | no | `agy-loop`, hermes agent | `cli/src/agy_loop.rs`, `agent_cmd.rs` | ✅ (agentic loop) |
| Polls | `src/polls` | no | — | — | ⚠️ not ported (see GAPS) |

---

## GAPS RÉELS

Honest list of *neutral* subsystems thin/absent in aphrody, or Apple subsystems lacking a Google equivalent:

1. **Cron/scheduling is thin.** openclaw's `src/cron` is a large, battle-tested scheduler
   (delivery plans, heartbeats, session reaper, dozens of regression tests). aphrody's
   single-file `aphrody-cron` crate was removed on 2026-10-09 (no consumer). The CLI orchestrates scheduling via skills/loops,
   but there is no equivalent persistent cron service with delivery/heartbeat semantics.
   **Real gap (neutral).**

2. **Sandbox backends limited.** openclaw offers Docker (default), SSH, and OpenShell sandbox
   backends with per-session policy (`sandbox.mode: non-main`). aphrody has a native
   `SandboxShell` (host process with cwd scoping) in `aphrody-sdk/src/shell.rs` but **no
   Docker/SSH/containerized backend**. **Partial gap (neutral)** — security isolation is weaker.

3. **Gmail Pub/Sub hook not ported.** openclaw has a full `src/hooks/gmail*` watcher
   (Gmail push automation). aphrody has a generic hooks/events system but no Gmail integration.
   **Minor gap (neutral, but Google-relevant)** — worth noting since aphrody is Google-centric,
   this is one Google integration openclaw has that aphrody lacks.

4. **Polls.** openclaw `src/polls` (interactive channel polls). No aphrody equivalent.
   **Minor gap (neutral).**

5. **No general-purpose Web Control UI.** openclaw ships a `ui/` Control UI + WebChat.
   aphrody has `a2a-ui` (A2A-protocol native UI) and gateway HTTP, but no equivalent
   browser Control UI (the TS/web UI surfaces were extracted to the sibling `aphrody-ts` repo).
   **Partial gap in *this* repo** (by the Rust-only extraction policy, not a true capability loss
   project-wide).

Subsystems that are **NOT gaps** (deliberately out-of-scope): all non-Google/Anthropic
providers (OpenAI, Bedrock, Mistral, xAI, …), all channels except Discord/X (WhatsApp,
Telegram-as-primary, Signal, IRC, Teams, …), and every Apple-specific surface (iMessage,
Apple HIG, SwiftUI macOS/iOS apps, Apple Push) — each Apple design/UI surface has its
Google M3 equivalent in `m3-tokens`/`aphrody-design`/`mui-rs*`.

---

## Verdict

**aphrody IS an improved version of openclaw — YES**, within its deliberate Google-centric,
Rust-only, narrowed-scope mandate.

Justification:
- **Providers improved:** Google (keyless OAuth + cookie + Vertex/Cloud-Code, Nano Banana Pro
  image, Veo video, deep-research) and Anthropic (native BYOK streaming mirroring openclaw's own
  wire shape) are both present and richer than openclaw's generic plugin shells, plus a unified
  `aphrody-llm-infra` (cache/cost/retry/rate).
- **Channels confirmed:** Discord + X both present; X (158 live GraphQL ops, keyless) and
  full-duplex voice via hermes are net-new vs openclaw.
- **Neutral subsystems mostly matched** (gateway, routing, sessions, memory-richer, skills,
  marketplace, MCP-with-OAuth, permissions, pairing/allowlist, onboarding compat, telemetry,
  secrets), with **net-new** capabilities (8× LLM-first terminal crates, RE/forensics, A2A UI).
- **Apple → Google mapping complete:** Apple HIG / SwiftUI / macOS-iOS apps / Canvas all have
  Google M3 / A2A equivalents.

Caveats (true gaps): cron scheduler is thin, sandbox lacks Docker/SSH backends, Gmail Pub/Sub
hook and polls not ported, and the browser Control UI lives in the sibling `aphrody-ts` repo
(out of this Rust-only repo). These are the only honest neutral shortfalls; none touch the
Google/Anthropic + Discord/X focus areas.
