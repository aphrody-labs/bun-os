//! AI operations are resolved by a backend (the local model service of the AI layer). The core
//! never fakes a result: without a backend the render fails with [`crate::Error::AiUnavailable`].

use crate::{Error, Result};
use image::RgbaImage;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiKind {
    Upscale,
    Inpaint,
    RemoveBackground,
    Enhance,
}

/// Executes an AI operation on an RGBA8 image. `params` is backend-specific JSON (scale, prompt,
/// mask asset id, ...).
pub trait AiBackend: Sync {
    fn run(&self, kind: AiKind, image: &RgbaImage, params: &serde_json::Value)
    -> Result<RgbaImage>;
}

/// Backend used when none is configured.
pub struct NoBackend;

impl AiBackend for NoBackend {
    fn run(&self, kind: AiKind, _: &RgbaImage, _: &serde_json::Value) -> Result<RgbaImage> {
        Err(Error::AiUnavailable(format!(
            "{kind:?}: no backend configured"
        )))
    }
}
