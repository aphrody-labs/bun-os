<!-- SPDX-License-Identifier: Apache-2.0 -->

# gemini-web

Pure-Rust SDK for the **Gemini web app** (`gemini.google.com/app`) — the
consumer Gemini product, driven by the signed-in Google session cookies (no API
key). Mirrors the `notebooklm` crate's Boq `batchexecute` transport.

Full protocol reference: Aphrody OS protocol reference.
Feature matrix: Aphrody OS feature matrix.

## Auth

Export your signed-in Google cookies (e.g. the Cookie-Editor extension, JSON
array format) to `~/.aphrody/google-cookies.json`. The anti-CSRF `at` token is
scraped from the app page at construction — no key, no OAuth. Secrets stay under
your home directory; never inside the workspace.

## Quick start

```rust
use aphrody_gemini_web::{GeminiWebClient, GeminiModel};

# async fn run() -> aphrody_gemini_web::Result<()> {
// The caller installs a rustls CryptoProvider before the first request.
let client = GeminiWebClient::from_default_cookie_file("en").await?;

// One-shot (3.5 Flash by default):
let reply = client.ask("Explain io_uring in one sentence.", None).await?;
println!("{}", reply.text);

// Pick a model + continue the thread:
let header = GeminiModel::Pro.header();
let follow = client.send("And epoll?", Some(&header), &reply.metadata).await?;
println!("{} (images: {:?})", follow.text, follow.generated_image_urls);
# Ok(())
# }
```

## Surface

| Area      | Item                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Client    | `GeminiWebClient::{from_default_cookie_file, from_cookie_file, from_auth, ask, send, get_config_flag, refresh}`      |
| Models    | `GeminiModel::{FlashLite, Flash, Pro}` (verified header tokens), `ReasoningLevel::{Standard, Extended}` (Deep Think) |
| Reply     | `ChatReply { text, metadata, web_image_urls, generated_image_urls, generated_video_urls, candidate_count }`          |
| Transport | `HttpTransport::{rpc_raw, stream_generate}`, `SessionTokens`                                                         |
| Auth      | `Auth`, `CookieJar`, `SessionCookie`, `sapisidhash`                                                                  |
| Codec     | `boq::{encode_f_req, parse_envelopes, ...}`                                                                          |

## Consumers

- `aphrody-chat::GeminiWebBackend` — native 3.5 Flash chat backend.
- `aphrody-mcp` tools — `gemini_chat`, `gemini_image` (Nano Banana),
  `gemini_video` (Veo), `gemini_deep_research`.

## OS process boundary

`aphrody-web-ffi` in the OS repository invokes the `aphrody-gemini-web` binary
through stdin/stdout JSON. Install the binary on `PATH` or set
`APHRODY_GEMINI_WEB_BIN` to its absolute path. The request is
`{"cookie_path":"...","prompt":"...","model":"flash"}`; the response is the
legacy BXC object with `text`, `conversation_id`, `response_id`, and `choice_id`,
or an `error` object. The cookie path and prompt are never command-line
arguments. This process boundary keeps OS crates independent of the AI layer.

Both process clients are entries of the multi-call `aphrody` binary
(`aphrody gemini-web`, `aphrody embed`; `aphrody_gemini_web::cli_main`). The current
release CLI does not install the links automatically; put the matching
link on `PATH` or configure `APHRODY_GEMINI_WEB_BIN` explicitly. Production
installation has not been verified.

## Status

Verified live end-to-end: cookie auth → page bootstrap → `batchexecute` config
read → `StreamGenerate` send → reply + threading. Model selection (Flash-Lite /
3.5 Flash verified). Image/video extraction is response-side. Video (Veo) and
Deep Research are async generative flows reached via prompt-routing; mode-chip
activation + poll-to-completion are documented enhancements.
