// SPDX-License-Identifier: Apache-2.0
//! `yolo-ui-core`: Pure Rust dynamic color math, contrast calculations, and GPU shader templates.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ColorRgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl ColorRgb {
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Calculate relative luminance per WCAG 2.1 specifications.
    pub fn luminance(&self) -> f64 {
        let conv = |v: u8| -> f64 {
            let s = v as f64 / 255.0;
            if s <= 0.03928 {
                s / 12.92
            } else {
                ((s + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * conv(self.r) + 0.7152 * conv(self.g) + 0.0722 * conv(self.b)
    }

    /// Calculate contrast ratio between two colors (1.0 to 21.0).
    pub fn contrast_ratio(&self, other: &Self) -> f64 {
        let l1 = self.luminance();
        let l2 = other.luminance();
        let (lighter, darker) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
        (lighter + 0.05) / (darker + 0.05)
    }

    /// Check if contrast passes WCAG AA (4.5:1) for normal text.
    pub fn passes_wcag_aa(&self, other: &Self) -> bool {
        self.contrast_ratio(other) >= 4.5
    }

    /// Check if contrast passes WCAG AAA (7.0:1) for normal text.
    pub fn passes_wcag_aaa(&self, other: &Self) -> bool {
        self.contrast_ratio(other) >= 7.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoloDynamicPalette {
    pub primary: ColorRgb,
    pub secondary: ColorRgb,
    pub accent: ColorRgb,
    pub background: ColorRgb,
    pub surface: ColorRgb,
}

impl YoloDynamicPalette {
    /// Generate a dynamic harmonic palette in pure Rust from a seed color.
    pub fn from_seed(seed: ColorRgb, dark_mode: bool) -> Self {
        let secondary = ColorRgb::new(
            (seed.r as f32 * 0.7 + seed.b as f32 * 0.3) as u8,
            (seed.g as f32 * 0.8 + seed.r as f32 * 0.2) as u8,
            (seed.b as f32 * 0.9 + seed.g as f32 * 0.1) as u8,
        );
        let accent = ColorRgb::new(
            255 - seed.r,
            (seed.b as f32 * 0.8) as u8,
            255 - seed.g,
        );

        let (background, surface) = if dark_mode {
            (ColorRgb::new(11, 13, 19), ColorRgb::new(20, 24, 36))
        } else {
            (ColorRgb::new(248, 249, 252), ColorRgb::new(255, 255, 255))
        };

        Self {
            primary: seed,
            secondary,
            accent,
            background,
            surface,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wcag_contrast() {
        let black = ColorRgb::new(0, 0, 0);
        let white = ColorRgb::new(255, 255, 255);
        assert!(black.contrast_ratio(&white) > 20.9);
        assert!(black.passes_wcag_aaa(&white));
    }

    #[test]
    fn test_dynamic_palette() {
        let seed = ColorRgb::new(99, 102, 241);
        let pal = YoloDynamicPalette::from_seed(seed, true);
        assert_eq!(pal.primary.r, 99);
        assert_eq!(pal.background.r, 11);
    }
}
