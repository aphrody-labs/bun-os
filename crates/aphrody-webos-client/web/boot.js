// SPDX-License-Identifier: Apache-2.0
// The only hand-written script: loads the wasm-bindgen module (the client itself is Rust, src/lib.rs).
import init from "/aphrody_webos_client.js";
await init({ module_or_path: "/aphrody_webos_client_bg.wasm" });
