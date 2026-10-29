// SPDX-License-Identifier: Apache-2.0
//! Aphrody shell for WebAssembly.
//!
//! One `wasm-bindgen` surface serves every web-shaped host: a plain browser page, a bundler
//! (Bun/Vite) app and a Tauri webview. The transport is the host's job: a `WebSocket` to
//! `aphrody-terminal-backend::serve`, Tauri `invoke`/events to a native PTY, or no transport at
//! all: the WebOS Terminal feeds [`WebTerminal`] the bytes of a real shell (the Alpine guest).

pub mod opfs;
pub mod wire;

use crate::opfs::SharedOpfsVfs;
use aphrody_terminal_core::TerminalState;
use wasm_bindgen::prelude::*;

/// VT parser and grid, fed with bytes from any transport.
#[wasm_bindgen]
pub struct WebTerminal {
    state: TerminalState,
}

#[wasm_bindgen]
impl WebTerminal {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            state: TerminalState::new(cols, rows),
        }
    }

    /// Applies output bytes from the shell.
    pub fn ingest(&mut self, bytes: &[u8]) {
        self.state.ingest(bytes);
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.state.resize(cols, rows);
    }

    /// VT replies (CPR/DSR) the host must send back to the shell.
    pub fn take_replies(&mut self) -> Vec<String> {
        self.state.take_replies()
    }

    /// Visible rows as plain text.
    #[must_use]
    pub fn lines(&self) -> Vec<String> {
        self.state.snapshot().lines
    }

    /// Fast in-memory screen text scraping for AI perception and automated tests.
    #[must_use]
    pub fn scrape_text(&self) -> String {
        self.state.snapshot().lines.join("\n")
    }

    /// `{columns, rows, lines, cursor:{row,col,visible}}` for a renderer.
    #[must_use]
    pub fn snapshot_json(&self) -> String {
        let snap = self.state.styled_snapshot();
        let lines = self.state.snapshot().lines;
        serde_json::json!({
            "columns": snap.columns,
            "rows": snap.rows,
            "lines": lines,
            "cursor": {
                "row": snap.cursor.pos.row.0,
                "col": snap.cursor.pos.col.0,
                "visible": snap.cursor.is_visible(),
            },
        })
        .to_string()
    }
}

/// JSON text frame asking a remote PTY to resize.
#[wasm_bindgen]
#[must_use]
pub fn resize_frame(cols: u16, rows: u16) -> String {
    wire::resize_frame(cols, rows)
}

/// JSON text frame carrying input bytes.
#[wasm_bindgen]
#[must_use]
pub fn data_frame(bytes: &[u8]) -> String {
    wire::data_frame(bytes)
}

/// Run the shared VFS conformance suite in a browser WASM instance.
#[wasm_bindgen]
pub fn opfs_vfs_conformance() {
    aphrody_shell_vfs::conformance::run(crate::opfs::OpfsVfs::new);
}
