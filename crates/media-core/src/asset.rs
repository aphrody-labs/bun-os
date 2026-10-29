//! Content-addressed assets and the proxy/thumbnail cache.

use crate::ai::AiBackend;
use crate::graph::{EditStack, Filter};
use crate::{Result, engine};
use image::{ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// blake3 of the file bytes, hex.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct AssetId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetMeta {
    pub id: AssetId,
    pub bytes: u64,
    pub format: String,
    pub width: u32,
    pub height: u32,
    /// EXIF orientation 1..=8 when present.
    pub orientation: Option<u32>,
}

/// Probe bytes: id, format, dimensions (header only), EXIF orientation.
pub fn probe(bytes: &[u8]) -> Result<AssetMeta> {
    let id = AssetId(blake3::hash(bytes).to_hex().to_string());
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()?;
    let format = reader.format();
    let (width, height) = reader.into_dimensions()?;
    let orientation = exif::Reader::new()
        .read_from_container(&mut std::io::Cursor::new(bytes))
        .ok()
        .and_then(|e| {
            e.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
        });
    Ok(AssetMeta {
        id,
        bytes: bytes.len() as u64,
        format: format.map(|f| format!("{f:?}").to_lowercase()).unwrap_or_default(),
        width,
        height,
        orientation,
    })
}

/// Decode to RGBA8 and apply the EXIF orientation.
pub fn decode(bytes: &[u8], orientation: Option<u32>) -> Result<RgbaImage> {
    use image::imageops::*;
    let img = image::load_from_memory(bytes)?.to_rgba8();
    Ok(match orientation {
        Some(2) => flip_horizontal(&img),
        Some(3) => rotate180(&img),
        Some(4) => flip_vertical(&img),
        Some(5) => flip_horizontal(&rotate90(&img)),
        Some(6) => rotate90(&img),
        Some(7) => flip_horizontal(&rotate270(&img)),
        Some(8) => rotate270(&img),
        _ => img,
    })
}

/// Directory cache of rendered proxies keyed by (asset, stack digest, max edge).
pub struct ProxyCache {
    dir: PathBuf,
}

impl ProxyCache {
    pub fn open(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn path(&self, id: &AssetId, stack: &EditStack, max_edge: u32) -> PathBuf {
        self.dir.join(format!("{}-{}-{max_edge}.png", id.0, &stack.digest()[..16]))
    }

    /// Return the cached proxy or render it (decode, stack, fit to `max_edge`) and store it.
    /// The bool is true on a cache hit.
    pub fn get_or_render(
        &self,
        bytes: &[u8],
        stack: &EditStack,
        max_edge: u32,
        ai: &dyn AiBackend,
    ) -> Result<(PathBuf, bool)> {
        let meta = probe(bytes)?;
        let p = self.path(&meta.id, stack, max_edge);
        if p.exists() {
            return Ok((p, true));
        }
        let src = decode(bytes, meta.orientation)?;
        let mut out = engine::render(&src, stack, ai)?;
        let (w, h) = out.dimensions();
        let s = (f64::from(max_edge) / f64::from(w.max(h))).min(1.0);
        if s < 1.0 {
            out = engine::resize(
                &out,
                ((f64::from(w) * s).round() as u32).max(1),
                ((f64::from(h) * s).round() as u32).max(1),
                Filter::Lanczos3,
            )?;
        }
        let tmp = p.with_extension("tmp");
        out.save_with_format(&tmp, ImageFormat::Png)?;
        std::fs::rename(&tmp, &p)?;
        Ok((p, false))
    }
}
