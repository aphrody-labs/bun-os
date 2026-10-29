//! Non-destructive edit stack.

use crate::ai::AiKind;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Filter {
    Box,
    Bilinear,
    Mitchell,
    Lanczos3,
}

/// One operation. Parameters are integers (milli-units) so the stack hashes deterministically.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    Crop { x: u32, y: u32, w: u32, h: u32 },
    Resize { w: u32, h: u32, filter: Filter },
    /// Gaussian blur, sigma in thousandths of a pixel.
    Blur { sigma_milli: u32 },
    /// Brightness offset in -255..=255.
    Brightness { delta: i32 },
    /// Contrast factor in thousandths (1000 = unchanged).
    Contrast { factor_milli: u32 },
    Grayscale,
    Invert,
    FlipH,
    FlipV,
    Rotate90,
    /// AI operation resolved by the configured backend; `params` is a JSON string.
    Ai { kind: AiKind, params: String },
}

/// Ordered list of operations applied to a source asset.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EditStack {
    pub ops: Vec<Op>,
}

impl EditStack {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(mut self, op: Op) -> Self {
        self.ops.push(op);
        self
    }

    /// Stable content hash of the stack (blake3 of its JSON), used as cache key.
    pub fn digest(&self) -> String {
        let json = serde_json::to_vec(self).unwrap_or_default();
        blake3::hash(&json).to_hex().to_string()
    }
}
