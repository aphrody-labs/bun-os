// SPDX-License-Identifier: Apache-2.0
//! `wrap.json`, written by `@aphrody/web-to-tauri` (`m3/packages/web-to-tauri/src/types.ts`).

use std::collections::HashMap;
use std::fmt;

use serde::Deserialize;

use crate::wrap::policy::Pattern;

/// Schema identifier of `wrap.json`.
pub const SCHEMA: &str = "aphrody-web-to-tauri/1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Remote,
    Bundle,
    Sidecar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    /// The one desktop runtime. `wry` (system webview) is retired and refused.
    Cef,
}

/// What happens to a navigation that leaves the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum External {
    System,
    Inapp,
    Deny,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Origins {
    pub app: Vec<String>,
    pub auth: Vec<String>,
    pub embeds: Vec<String>,
    pub external: External,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub title: Option<String>,
    pub width: f64,
    pub height: f64,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub sync_title: bool,
    pub zoom_hotkeys: bool,
    pub drag_drop: bool,
}

/// Only the bundle server reads these fields; a build without the `bundle` feature still parses them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(feature = "wrap-bundle"), allow(dead_code))]
pub struct Bundle {
    pub dir: String,
    pub backend: Option<String>,
    pub proxy: Vec<String>,
    pub spa_fallback: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sidecar {
    pub program: String,
    pub args: Vec<String>,
    pub port: u16,
    pub ready_path: String,
    pub ready_timeout_secs: u64,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrapConfig {
    pub schema: String,
    pub name: String,
    pub identifier: String,
    pub mode: Mode,
    pub engine: Engine,
    pub start: String,
    pub origins: Origins,
    pub window: Window,
    pub user_agent: Option<String>,
    pub bundle: Option<Bundle>,
    pub sidecar: Option<Sidecar>,
}

/// Why a `wrap.json` was refused. The app does not start with a configuration it cannot honour.
#[derive(Debug)]
pub struct ConfigError(String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid wrap.json: {}", self.0)
    }
}

impl std::error::Error for ConfigError {}

impl WrapConfig {
    /// Parses and validates a `wrap.json`.
    ///
    /// # Errors
    ///
    /// Fails on malformed JSON, another schema, a mode without its section, an invalid origin
    /// pattern or an unusable start URL.
    pub fn parse(json: &str) -> Result<Self, ConfigError> {
        let config: Self =
            serde_json::from_str(json).map_err(|error| ConfigError(error.to_string()))?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        let fail = |message: String| Err(ConfigError(message));
        if self.schema != SCHEMA {
            return fail(format!("schema {} is not {SCHEMA}", self.schema));
        }
        match self.mode {
            Mode::Remote => {
                let url = url::Url::parse(&self.start)
                    .map_err(|error| ConfigError(format!("start: {error}")))?;
                if !matches!(url.scheme(), "http" | "https") {
                    return fail(format!("start must be http(s), got {}", url.scheme()));
                }
            }
            Mode::Bundle => {
                if self.bundle.is_none() {
                    return fail("mode bundle needs a bundle section".into());
                }
                if !self.start.starts_with('/') {
                    return fail("start must be a path in bundle mode".into());
                }
            }
            Mode::Sidecar => {
                if self.sidecar.is_none() {
                    return fail("mode sidecar needs a sidecar section".into());
                }
                if !self.start.starts_with('/') {
                    return fail("start must be a path in sidecar mode".into());
                }
            }
        }
        let all = self
            .origins
            .app
            .iter()
            .chain(&self.origins.auth)
            .chain(&self.origins.embeds);
        for pattern in all {
            if Pattern::parse(pattern).is_none() {
                return fail(format!(
                    "origin pattern {pattern:?} is not scheme://host[:port][/path/*]"
                ));
            }
        }
        if let Some(backend) = self
            .bundle
            .as_ref()
            .and_then(|bundle| bundle.backend.as_ref())
        {
            let url = url::Url::parse(backend)
                .map_err(|error| ConfigError(format!("backend: {error}")))?;
            if !matches!(url.scheme(), "http" | "https") {
                return fail(format!("backend must be http(s), got {}", url.scheme()));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote() -> String {
        r#"{
          "schema": "aphrody-web-to-tauri/1", "name": "Demo", "identifier": "io.aphrody.wrapped.demo",
          "mode": "remote", "engine": "cef", "start": "https://example.com/",
          "origins": { "app": ["https://example.com"], "auth": [], "embeds": [], "external": "system" },
          "window": { "title": null, "width": 1280, "height": 800, "minWidth": null, "minHeight": null,
                      "syncTitle": true, "zoomHotkeys": true, "dragDrop": false },
          "userAgent": null, "bundle": null, "sidecar": null
        }"#
        .to_string()
    }

    #[test]
    fn parses_a_remote_config() {
        let config = WrapConfig::parse(&remote()).unwrap();
        assert_eq!(config.mode, Mode::Remote);
        assert_eq!(config.engine, Engine::Cef);
        assert_eq!(config.origins.external, External::System);
        assert!(config.window.title.is_none());
        assert!(!config.window.drag_drop);
    }

    #[test]
    fn refuses_another_schema_and_unknown_fields_values() {
        assert!(WrapConfig::parse(&remote().replace("web-to-tauri/1", "web-to-tauri/9")).is_err());
        assert!(WrapConfig::parse(&remote().replace("\"remote\"", "\"hybrid\"")).is_err());
        assert!(WrapConfig::parse("{}").is_err());
    }

    #[test]
    fn a_mode_needs_its_section_and_a_matching_start() {
        let bundle = remote()
            .replace("\"remote\"", "\"bundle\"")
            .replace("https://example.com/", "/");
        assert!(
            WrapConfig::parse(&bundle)
                .unwrap_err()
                .to_string()
                .contains("bundle section")
        );
        let sidecar = remote().replace("\"remote\"", "\"sidecar\"");
        assert!(
            WrapConfig::parse(&sidecar)
                .unwrap_err()
                .to_string()
                .contains("sidecar section")
        );
        assert!(WrapConfig::parse(&remote().replace("https://example.com/", "/home")).is_err());
        assert!(
            WrapConfig::parse(&remote().replace("https://example.com/", "file:///etc/passwd"))
                .is_err()
        );
    }

    #[test]
    fn refuses_an_origin_pattern_that_would_silently_match_nothing() {
        let error = WrapConfig::parse(&remote().replace(
            "\"app\": [\"https://example.com\"]",
            "\"app\": [\"example.com\"]",
        ))
        .unwrap_err();
        assert!(error.to_string().contains("example.com"));
    }
}
