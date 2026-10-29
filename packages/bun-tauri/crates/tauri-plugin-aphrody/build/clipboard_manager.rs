// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

const COMMANDS: &[&str] = &[
    "write_text",
    "read_text",
    "write_image",
    "read_image",
    "write_html",
    "clear",
    "write_secret",
];

/// Build description of the `clipboard-manager` plugin.
pub fn builder() -> tauri_plugin::Builder<'static> {
    tauri_plugin::Builder::new(COMMANDS).global_api_script_path("iife/clipboard-manager.js")
}
