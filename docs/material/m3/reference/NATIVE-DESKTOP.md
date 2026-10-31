<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native desktop and distribution boundary

Tauri 3 (`tauri-runtime-wry`) is the current host for Aphrody's public Chat, Files, Models and Settings webview.
Rust M3, rendering and window crates remain reusable foundations, not a commitment to build
an Aphrody-owned operating-system shell or browser from scratch.

Aphrody is a Rust distribution. When a standalone shell or browser is needed, evaluate mature
Rust GUIs, upstream maintenance, licensing, accessibility and packaging first. Package the
best fit where possible. Build a custom wgpu/full-Rust host only for a documented product gap;
keep that application separate from the privileged consumer webview.

The app-ui webview does not include browser navigation, shell/PTY/terminal sessions, SSH
consoles or infrastructure diagnostics. Backend web retrieval and OS process/job APIs remain
with their owners and are exposed only through explicit product actions.

See [M3 host boundaries](../plans/design/M3-MULTI-HOST-PLAN.md), [GUI contract](./GUI.md). Any standalone native package needs its own
installed-bundle, accessibility, update, offline and process-lifecycle evidence.
