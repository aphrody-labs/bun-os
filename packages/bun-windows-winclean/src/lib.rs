// SPDX-License-Identifier: Apache-2.0
//! Bun-owned WinClean compatibility surface.
//!
//! Generated typed methods call the in-process Rust dispatcher. There is no
//! managed runtime or external DLL bridge here.

pub mod browser;
mod clipboard;
mod coordination;
mod defender;
pub mod dispatch;
mod eventlog;
pub mod filesystem;
pub mod gamepad;
pub mod gaming;
mod generated;
pub mod memory;
mod notification;
pub mod nt;
pub mod ocr;
pub mod record;
pub mod registry;
mod services;
pub mod shell;
pub mod snapshot;
pub mod speech;
mod steam;
pub mod system;
pub mod tweaks;
mod tcp;
#[cfg(any(windows, test))]
mod timefmt;
#[cfg(windows)]
mod win32;
#[cfg(windows)]
mod windows_search;
pub mod winml;
#[cfg(windows)]
mod winreg;
mod wsl;

use base64::Engine as _;
pub use generated::*;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("tool error: {0}")]
    Tool(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum SubsystemError {
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    #[error("invalid arguments: {0}")]
    InvalidArguments(String),
    #[error("{0}")]
    Failed(String),
    #[error("subsystem unavailable: {0}")]
    Unavailable(String),
}

pub const CATALOG_JSON: &str = include_str!("tools.json");

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[must_use]
pub fn catalog() -> &'static [ToolInfo] {
    static CATALOG: std::sync::OnceLock<Vec<ToolInfo>> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        #[derive(Deserialize)]
        struct Catalog {
            tools: Vec<ToolInfo>,
        }
        serde_json::from_str::<Catalog>(CATALOG_JSON)
            .map(|catalog| catalog.tools)
            .unwrap_or_default()
    })
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Winclean;

pub fn shared() -> Result<&'static Winclean, String> {
    static INSTANCE: Winclean = Winclean;
    Ok(&INSTANCE)
}

impl Winclean {
    pub fn load() -> Result<Self> {
        Ok(Self)
    }

    pub fn version(&self) -> Result<String> {
        Ok(env!("CARGO_PKG_VERSION").to_owned())
    }

    pub fn list_tools(&self) -> Result<Vec<ToolInfo>> {
        Ok(catalog().to_vec())
    }

    pub fn call<A: Serialize + ?Sized>(&self, tool: &str, args: &A) -> Result<ToolResult> {
        let json = self.call_raw(tool, &serde_json::to_string(args)?)?;
        Ok(serde_json::from_str(&json)?)
    }

    pub fn call_raw(&self, tool: &str, args_json: &str) -> Result<String> {
        let arguments: serde_json::Value = serde_json::from_str(args_json)?;
        let result = match dispatch::call_rust(tool, arguments) {
            Ok(value) => ToolResult {
                content: Vec::new(),
                structured_content: Some(value),
                is_error: false,
            },
            Err(error) => ToolResult {
                content: vec![Content::Text {
                    text: error.to_string(),
                }],
                structured_content: None,
                is_error: true,
            },
        };
        Ok(serde_json::to_string(&result)?)
    }

    pub async fn call_async<A: Serialize + ?Sized>(
        &self,
        tool: &str,
        args: &A,
    ) -> Result<ToolResult> {
        let json = self.call_raw(tool, &serde_json::to_string(args)?)?;
        Ok(serde_json::from_str(&json)?)
    }

    pub async fn call_raw_async(&self, tool: &str, args_json: &str) -> Result<String> {
        self.call_raw(tool, args_json)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Content {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    Audio {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone)]
pub struct Blob {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    #[serde(default)]
    pub content: Vec<Content>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<serde_json::Value>,
    #[serde(default)]
    pub is_error: bool,
}

impl ToolResult {
    #[must_use]
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|content| match content {
                Content::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn ok(self) -> Result<Self> {
        if self.is_error {
            Err(Error::Tool(self.text()))
        } else {
            Ok(self)
        }
    }

    pub fn json<T: DeserializeOwned>(&self) -> Result<T> {
        if self.is_error {
            return Err(Error::Tool(self.text()));
        }
        if let Some(value) = &self.structured_content {
            return Ok(T::deserialize(value)?);
        }
        let first = self.content.iter().find_map(|content| match content {
            Content::Text { text } => Some(text.as_str()),
            _ => None,
        });
        Ok(serde_json::from_str(first.unwrap_or("null"))?)
    }

    #[must_use]
    pub fn images(&self) -> Vec<Blob> {
        self.content
            .iter()
            .filter_map(|content| match content {
                Content::Image { data, mime_type } => base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .ok()
                    .map(|bytes| Blob {
                        mime_type: mime_type.clone(),
                        bytes,
                    }),
                _ => None,
            })
            .collect()
    }
}
