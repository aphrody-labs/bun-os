//! Shared media core for the craft apps (photocraft, lightcraft, filmcraft, effectcraft,
//! vectorcraft) and the `@aphrody/media` Bun API.
//!
//! * [`asset`]: content-addressed assets (blake3), metadata (dimensions, EXIF orientation) and an
//!   on-disk proxy/thumbnail cache keyed by (asset, edit stack, size).
//! * [`graph`]: the non-destructive [`graph::EditStack`] (serde, hashable) and its operations,
//!   including AI hooks resolved through an [`ai::AiBackend`].
//! * [`engine`]: renders a stack on an RGBA8 image (fast_image_resize + rayon).
//! * [`project`]: project format and cross-app [`project::Handoff`] files.
#![forbid(unsafe_code)]

pub mod ai;
pub mod asset;
pub mod engine;
pub mod graph;
pub mod project;

/// Crate error type.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("image: {0}")]
    Image(#[from] image::ImageError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("resize: {0}")]
    Resize(String),
    #[error("invalid operation: {0}")]
    Invalid(String),
    #[error("AI backend unavailable: {0}")]
    AiUnavailable(String),
    #[error("unsupported project version {0}")]
    Version(u32),
}

pub type Result<T> = std::result::Result<T, Error>;
