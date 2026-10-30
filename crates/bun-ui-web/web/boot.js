// SPDX-License-Identifier: Apache-2.0
// The only hand-written script: loads the wasm-bindgen module (the host itself is Rust, src/host.rs).
import init from "/ui/host/bun_ui_web.js";
await init({ module_or_path: "/ui/host/bun_ui_web_bg.wasm" });
