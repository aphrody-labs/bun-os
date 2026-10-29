// SPDX-License-Identifier: Apache-2.0
//! Asset runtime: the engine-facing layer that serves decoded assets from the merged game set.
//!
//! Wraps a [`UnifiedVfs`], so an engine reads Inazuma Eleven and Dragon Ball Xenoverse 2 content
//! through one handle. [`AssetRuntime::describe`] streams one `<game>/<path>` entry and, when its
//! format has a native byte-level reader in [`crate::game::formats`], decodes it into structured
//! data (textures, models, materials, skills, hitboxes, damage, text, physics). Formats without a
//! reader still return their identity and size, so the catalog stays complete.

use std::path::Path;

use serde_json::{Value, json};

use super::assets::AssetResult;
use super::formats::ema::EmaFile;
use super::formats::emo::EmoFile;
use super::formats::{
    BacFile, BdmFile, CmsFile, CusFile, EmbFile, EmdFile, EmmFile, MsgFile, PupFile,
};
use super::unified_vfs::UnifiedVfs;

/// A streamed, format-decoding view over the merged games.
pub struct AssetRuntime {
    vfs: UnifiedVfs,
}

impl AssetRuntime {
    /// Wrap a mounted unified view.
    #[must_use]
    pub fn new(vfs: UnifiedVfs) -> Self {
        Self { vfs }
    }

    /// The underlying unified mount (games, index, search, raw streamed reads).
    #[must_use]
    pub fn vfs(&self) -> &UnifiedVfs {
        &self.vfs
    }

    /// Give the unified mount back.
    #[must_use]
    pub fn into_vfs(self) -> UnifiedVfs {
        self.vfs
    }

    /// Extensions this runtime decodes into structured data.
    #[must_use]
    pub fn decodable() -> &'static [&'static str] {
        &[
            "emb", "emd", "emm", "emo", "ema", "bac", "bdm", "cus", "cms", "msg", "pup",
        ]
    }

    /// Stream `<game>/<path>` and, when its format is known, decode it.
    ///
    /// Returns `{ path, kind, format, size, decodable, decoded, decodeError }`: `decoded` is the
    /// structured value when a reader succeeded, `decodeError` the reader's message when it
    /// failed, both absent for a format without a reader.
    ///
    /// # Errors
    /// The entry cannot be found or streamed from its owning mount.
    pub fn describe(&self, path: &str) -> AssetResult<Value> {
        let bytes = self.vfs.read(path)?;
        let (kind, format) = self
            .vfs
            .find(path)
            .map(|(_, entry)| (format!("{:?}", entry.kind), entry.format.clone()))
            .unwrap_or_default();
        let ext = Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let (decoded, decode_error) = match decode(&ext, &bytes) {
            Some(Ok(value)) => (Some(value), None),
            Some(Err(message)) => (None, Some(message)),
            None => (None, None),
        };
        Ok(json!({
            "path": path,
            "kind": kind,
            "format": format,
            "size": bytes.len(),
            "decodable": Self::decodable().contains(&ext.as_str()),
            "decoded": decoded,
            "decodeError": decode_error,
        }))
    }
}

/// Decode `bytes` of a known extension into a structured value, or `None` when unsupported.
///
/// DBXV2 Dimps formats are read by this crate's own parsers; everything else falls back to the
/// canonical `aphrody-nie-formats` dispatch table — the same byte→JSON decoder the `nie decode`
/// CLI and the nie FFI use (IEVR `g4tx`/`g4md`/`g4pk`, `cfg.bin`/`objbin`, `lip`, Lua bytecode,
/// CPK, CRI audio …). So one engine decodes both games through one path, reusing the nie crate.
fn decode(ext: &str, bytes: &[u8]) -> Option<Result<Value, String>> {
    macro_rules! read {
        ($ty:ty) => {{
            Some(
                <$ty>::parse(bytes)
                    .map_err(|error| error.to_string())
                    .and_then(|parsed| {
                        serde_json::to_value(parsed).map_err(|error| error.to_string())
                    }),
            )
        }};
    }
    let dimps = match ext {
        "emb" => read!(EmbFile),
        "emd" => read!(EmdFile),
        "emm" => read!(EmmFile),
        "emo" => read!(EmoFile),
        "ema" => read!(EmaFile),
        "bac" => read!(BacFile),
        "bdm" => read!(BdmFile),
        "cus" => read!(CusFile),
        "cms" => read!(CmsFile),
        "msg" => read!(MsgFile),
        "pup" => read!(PupFile),
        _ => None,
    };
    dimps.or_else(|| decode_with_nie(bytes))
}

/// Fall back to the shared `aphrody-nie-formats` decoder (auto-detected by magic).
fn decode_with_nie(bytes: &[u8]) -> Option<Result<Value, String>> {
    let decoded = aphrody_nie_formats::decode::decode(bytes)?;
    Some(serde_json::from_slice::<Value>(&decoded.json).map_err(|error| error.to_string()))
}
