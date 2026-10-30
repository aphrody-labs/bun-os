// SPDX-License-Identifier: Apache-2.0 OR MIT
//! Build script: generates the permissions of the `aphrody` plugin (Bun runtime, see `src/bun`).

const COMMANDS: &[&str] = &["bun_info", "bun_request", "bun_restart"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .global_api_script_path("iife/aphrody.js")
        .build();
}
