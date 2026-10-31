// SPDX-License-Identifier: Apache-2.0
//! bun-ui in the browser.
//!
//! One bundle per app under `<ui dir>/<toolkit>/<id>/`, described by `bun-ui.json` ([`Bundle`]), written by
//! `buncc build <recipe>` (packages/buncc/src/ui). Kinds:
//! - [`BundleKind::WasmBindgen`]: Rust toolkits (iced, libcosmic) built for `wasm32-unknown-unknown`, wasm-bindgen glue;
//! - [`BundleKind::Emscripten`]: C/C++ toolkits (Qt for WebAssembly, GTK through Emscripten) with the emcc glue;
//! - [`BundleKind::Broadway`]: a native GTK 4 app on the host whose GDK Broadway backend streams to the page; the
//!   server proxies `/ui/gtk/<id>/` (HTTP and the `broadway` WebSocket) to its `gtk4-broadwayd`.
//!
//! Feature `server` mounts the `/ui` routes in aphrody.com (`crates/aphrody-webos-server`). On wasm32 the crate is the
//! host: it lists the catalog and composes the apps as windows (one iframe surface each) with a clipboard and OPFS
//! storage bridge ([`bridge`]).

use serde::{Deserialize, Serialize};

pub const MANIFEST: &str = "bun-ui.json";
pub const SCHEMA_VERSION: u32 = 1;

/// The toolkit an app is written with; also the first path segment under `/ui/`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Toolkit {
    Iced,
    Libcosmic,
    Gtk,
    Qt,
    Servo,
    Cef,
}

impl Toolkit {
    pub const ALL: [Self; 6] = [Self::Iced, Self::Libcosmic, Self::Gtk, Self::Qt, Self::Servo, Self::Cef];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Iced => "iced",
            Self::Libcosmic => "libcosmic",
            Self::Gtk => "gtk",
            Self::Qt => "qt",
            Self::Servo => "servo",
            Self::Cef => "cef",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.as_str() == s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BundleKind {
    WasmBindgen,
    Emscripten,
    Broadway,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BundleFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BundleSource {
    /// Repository path or URL of the app source.
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub commit: String,
    /// buncc recipe id that produced the bundle.
    #[serde(default)]
    pub recipe: String,
}

/// `bun-ui.json`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub schema_version: u32,
    pub id: String,
    pub toolkit: Toolkit,
    pub title: String,
    pub kind: BundleKind,
    /// Page loaded in the window surface, relative to the bundle directory (`index.html`).
    #[serde(default = "default_entry")]
    pub entry: String,
    /// Broadway only: `127.0.0.1:<port>` of the app's `gtk4-broadwayd`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    /// Extra `script-src` sources the bundle needs, restricted to [`ALLOWED_SCRIPT_SOURCES`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub script_src: Vec<String>,
    /// Initial window size in CSS pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<(u32, u32)>,
    #[serde(default)]
    pub source: BundleSource,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<BundleFile>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub built_at: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
}

fn default_entry() -> String {
    "index.html".into()
}

/// Upstream glue that needs more than `'self' 'wasm-unsafe-eval'`: Broadway's client page uses an inline `onload`.
pub const ALLOWED_SCRIPT_SOURCES: [&str; 2] = ["'unsafe-inline'", "'unsafe-eval'"];

impl Bundle {
    /// URL path of the bundle directory, with a trailing slash.
    pub fn base(&self) -> String {
        format!("/ui/{}/{}/", self.toolkit.as_str(), self.id)
    }

    /// Content-Security-Policy for responses of this bundle: framed by the host only, scripts from the origin plus the
    /// allowed extras the manifest declares.
    pub fn csp(&self) -> String {
        csp_with(
            self.script_src
                .iter()
                .filter(|s| ALLOWED_SCRIPT_SOURCES.contains(&s.as_str()))
                .map(String::as_str),
        )
    }

    /// Ids are path segments: lower-case ASCII, digits and `-`.
    pub fn valid_id(id: &str) -> bool {
        !id.is_empty()
            && id.len() <= 64
            && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    }
}

/// CSP of the `/ui` pages; `extra` adds `script-src` sources.
pub fn csp_with<'a>(extra: impl Iterator<Item = &'a str>) -> String {
    let mut script = String::from("'self' 'wasm-unsafe-eval'");
    for source in extra {
        script.push(' ');
        script.push_str(source);
    }
    format!(
        "default-src 'self'; script-src {script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; \
         media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; \
         frame-ancestors 'self'; base-uri 'none'; object-src 'none'; form-action 'self'"
    )
}

/// `GET /ui/apps.json`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Catalog {
    pub apps: Vec<Bundle>,
}

/// Messages an app surface may post to the host (`window.parent.postMessage({ "bunui": ... })`), and the replies.
pub mod bridge {
    use serde::{Deserialize, Serialize};

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(tag = "bunui", rename_all = "kebab-case")]
    pub enum Request {
        /// Write text to the system clipboard (needs a user gesture in the host page).
        ClipboardWrite { text: String },
        ClipboardRead { id: u32 },
        /// Origin-private file system, namespaced per app: `/<toolkit>-<app id>/<path>`.
        FsRead { id: u32, path: String },
        FsWrite { id: u32, path: String, text: String },
        /// Retitle the window.
        Title { text: String },
    }

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(tag = "bunui", rename_all = "kebab-case")]
    pub enum Reply {
        Ok { id: u32, text: Option<String> },
        Error { id: u32, message: String },
    }
}

#[cfg(feature = "server")]
mod server;
#[cfg(feature = "server")]
pub use server::{load_catalog, router};

#[cfg(target_arch = "wasm32")]
mod host;
