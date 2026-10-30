// SPDX-License-Identifier: Apache-2.0 OR MIT
//! Upstream Bun as a first-class backend runtime for Tauri 3 apps. Official plugins (fs, dialog,
//! store, …) are the `tauri-plugin-*` crates of the workspace, not copies.
//!
//! The `aphrody` plugin ([`bun`]) runs a Bun server (script with `bun --hot`, or a `bun build --compile` sidecar) next to the app and bridges
//! the webview to it over IPC.

extern crate self as tauri_plugin_aphrody;

pub mod bun;

#[cfg(feature = "wrap")]
pub mod wrap;

pub use bun::init;
