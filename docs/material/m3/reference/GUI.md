<!-- SPDX-License-Identifier: Apache-2.0 -->
# Desktop GUI contract

## Product boundary

The desktop webview is hosted by the Tauri 3 (`tauri-runtime-wry`) app in `crates/ui/app`.
Its user areas are Chat, Files, Models and
Settings. Keep browser navigation, shell/PTY/terminal sessions, SSH host consoles,
system diagnostics and infrastructure administration outside this webview. The
Rust distribution may package mature standalone GUI applications when needed; this
repository does not need to recreate them.

Base UI and Tailwind CSS are maintained forks, adapted to M3 and optimized for the
Bun workspace. Keep them as the canonical React interaction and styling foundation.
Lit/material-web and Next.js remain separate package hosts, not extra product shells.

## Ownership and process boundary

| Capability | Owner | Webview contract |
| --- | --- | --- |
| Chat and agent sessions | `aphrody app-server` through the app broker | Typed request/event projection; AI stays out of the UI dependency graph. |
| Files and Drive | Spacedrive `sd-daemon` | Real file actions through the daemon boundary; Apache-2.0, see docs/spacedrive/PROVENANCE.md. |
| Models | AI/model owners through typed adapters | Show truthful install, availability and job state. |
| Settings and desktop integration | `aphrody-app` | Allow-listed commands and explicit window/platform capabilities. |
| Web retrieval | `aphrody-web` | Backend capability only; no embedded browsing or crawler administration UI. |
| Jobs/process policy | Aphrody OS | Reuse existing owner APIs; no shell execution or terminal bridge in app-ui. |

The webview is not an execution or permission authority. Do not load arbitrary remote
pages into the privileged Tauri window, expose generic IPC, spawn a CLI to dispatch an
owned in-process operation, or fabricate progress/success. Keep runtime state in the
platform app-data layout and AI in its resident out-of-process server.

## Release evidence

A method name, mock, screenshot or source review is not runtime proof. Before release,
verify a real Chat turn and interruption/recovery, Drive-backed Files mutations, truthful
model lifecycle, keyboard/screen-reader behavior, offline packaging, process cleanup,
source provenance and license inventory. Tauri evidence does not qualify a future native
host. See [the M3 host boundary](../plans/design/M3-MULTI-HOST-PLAN.md), [UI design](../architecture/UI-DESIGN.md),
[UX flows](../architecture/UX-DESIGN.md), [UI rules](./UI-RULES.md) and the cross-repository
[AI plan](https://github.com/aphrody-labs/aphrody/blob/main/docs/plans/ai/PLAN.md).
