// SPDX-License-Identifier: Apache-2.0
//! Authoring-side PBR material definitions and the preset library.
//!
//! A [`MaterialDef`] is the user-facing form (sRGB hex colours or an M3
//! colour role); [`MaterialDef::to_material`] lowers it to the renderer's
//! metallic/roughness [`Material`]. Presets use measured-style base colours
//! for common metals and dielectrics.

use aphrody_m3_tokens::facade::color::Role;
use serde::{Deserialize, Serialize};

use crate::{
    scene::{Paint, Rgba8},
    scene3d::Material,
};

/// A user-facing PBR material.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialDef {
    /// Base colour as `#rrggbb` or `#rrggbbaa` (sRGB); ignored when `role`
    /// is set.
    #[serde(default)]
    pub color: Option<String>,
    /// M3 colour role name (for example `primary`), resolved per scheme.
    #[serde(default)]
    pub role: Option<String>,
    /// Metalness `[0, 1]`.
    #[serde(default)]
    pub metallic: f32,
    /// Perceptual roughness `[0, 1]`.
    #[serde(default = "default_roughness")]
    pub roughness: f32,
    /// Emissive colour (`#rrggbb`).
    #[serde(default)]
    pub emissive: Option<String>,
    /// Emissive multiplier.
    #[serde(default = "one")]
    pub emissive_intensity: f32,
    /// Opacity `[0, 1]`.
    #[serde(default = "one")]
    pub opacity: f32,
    /// Ignore lighting.
    #[serde(default)]
    pub unlit: bool,
    /// Render back faces.
    #[serde(default)]
    pub double_sided: bool,
    /// Cast shadows.
    #[serde(default = "yes")]
    pub cast_shadow: bool,
}

const fn default_roughness() -> f32 {
    0.5
}
const fn one() -> f32 {
    1.0
}
const fn yes() -> bool {
    true
}

impl Default for MaterialDef {
    fn default() -> Self {
        Self {
            color: Some("#bfb8ad".into()),
            role: None,
            metallic: 0.0,
            roughness: 0.6,
            emissive: None,
            emissive_intensity: 1.0,
            opacity: 1.0,
            unlit: false,
            double_sided: false,
            cast_shadow: true,
        }
    }
}

/// Names accepted by [`preset`].
pub const PRESETS: &[&str] = &[
    "clay", "plastic", "rubber", "gold", "silver", "copper", "iron", "chrome", "glass", "emissive",
    "skin", "primary",
];

/// A preset material by name.
#[must_use]
pub fn preset(name: &str) -> Option<MaterialDef> {
    let base = MaterialDef::default();
    let def = |color: &str, metallic: f32, roughness: f32| MaterialDef {
        color: Some(color.into()),
        metallic,
        roughness,
        ..base.clone()
    };
    Some(match name {
        "clay" => base.clone(),
        "plastic" => def("#d23c3c", 0.0, 0.35),
        "rubber" => def("#2b2b2b", 0.0, 0.9),
        "gold" => def("#ffc356", 1.0, 0.3),
        "silver" => def("#fcfaf5", 1.0, 0.25),
        "copper" => def("#fbd2c0", 1.0, 0.35),
        "iron" => def("#c4c7c7", 1.0, 0.55),
        "chrome" => def("#e9e9e9", 1.0, 0.08),
        "glass" => MaterialDef {
            opacity: 0.3,
            double_sided: true,
            cast_shadow: false,
            ..def("#dfeff5", 0.0, 0.05)
        },
        "emissive" => MaterialDef {
            emissive: Some("#4fd1ff".into()),
            emissive_intensity: 2.0,
            ..def("#0b2530", 0.0, 0.5)
        },
        "skin" => def("#e0ac90", 0.0, 0.55),
        "primary" => MaterialDef {
            color: None,
            role: Some("primary".into()),
            roughness: 0.4,
            ..base.clone()
        },
        _ => return None,
    })
}

/// Parse `#rgb`, `#rrggbb` or `#rrggbbaa`.
///
/// # Errors
/// A message for malformed input.
pub fn parse_hex(s: &str) -> Result<Rgba8, String> {
    let h = s.strip_prefix('#').unwrap_or(s);
    let byte = |i: usize| {
        h.get(i..i + 2)
            .and_then(|x| u8::from_str_radix(x, 16).ok())
            .ok_or_else(|| format!("invalid colour {s:?}"))
    };
    match h.len() {
        3 => {
            let nib = |i: usize| {
                h.get(i..=i)
                    .and_then(|x| u8::from_str_radix(x, 16).ok())
                    .map(|v| v * 17)
                    .ok_or_else(|| format!("invalid colour {s:?}"))
            };
            Ok(Rgba8 {
                r: nib(0)?,
                g: nib(1)?,
                b: nib(2)?,
                a: 255,
            })
        }
        6 => Ok(Rgba8 {
            r: byte(0)?,
            g: byte(2)?,
            b: byte(4)?,
            a: 255,
        }),
        8 => Ok(Rgba8 {
            r: byte(0)?,
            g: byte(2)?,
            b: byte(4)?,
            a: byte(6)?,
        }),
        _ => Err(format!("invalid colour {s:?}")),
    }
}

/// Parse a paint: an M3 role name or a hex colour.
///
/// # Errors
/// A message for an unknown role or malformed colour.
pub fn parse_paint(s: &str) -> Result<Paint, String> {
    if s.starts_with('#') {
        return parse_hex(s).map(Paint::Fixed);
    }
    Role::from_name(&s.replace('_', "-"))
        .map(Paint::Role)
        .ok_or_else(|| format!("unknown M3 role {s:?}"))
}

impl MaterialDef {
    /// Lower to the renderer material.
    ///
    /// # Errors
    /// A message for invalid colours, roles or out-of-range factors.
    pub fn to_material(&self) -> Result<Material, String> {
        for (name, v) in [
            ("metallic", self.metallic),
            ("roughness", self.roughness),
            ("opacity", self.opacity),
        ] {
            if !(0.0..=1.0).contains(&v) {
                return Err(format!("{name} must be in [0, 1]"));
            }
        }
        if !(self.emissive_intensity.is_finite() && self.emissive_intensity >= 0.0) {
            return Err("emissive_intensity must be a non-negative number".into());
        }
        let base = match (&self.role, &self.color) {
            (Some(role), _) => parse_paint(role)?,
            (None, Some(c)) => Paint::Fixed(parse_hex(c)?),
            (None, None) => Paint::Fixed(parse_hex("#bfb8ad")?),
        };
        let emissive = self.emissive.as_deref().map(parse_paint).transpose()?;
        Ok(Material {
            base,
            metallic: self.metallic,
            roughness: self.roughness,
            emissive,
            emissive_intensity: self.emissive_intensity,
            opacity: self.opacity,
            unlit: self.unlit,
            double_sided: self.double_sided,
            cast_shadow: self.cast_shadow,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_lowers() {
        for name in PRESETS {
            let m = preset(name).unwrap().to_material().unwrap();
            assert!((0.0..=1.0).contains(&m.roughness), "{name}");
        }
        assert!(preset("unobtainium").is_none());
        assert!(matches!(
            preset("primary").unwrap().to_material().unwrap().base,
            Paint::Role(_)
        ));
        assert_eq!(preset("gold").unwrap().to_material().unwrap().metallic, 1.0);
    }

    #[test]
    fn hex_parsing_and_validation() {
        assert_eq!(
            parse_hex("#ff8000").unwrap(),
            Rgba8 {
                r: 255,
                g: 128,
                b: 0,
                a: 255
            }
        );
        assert_eq!(parse_hex("#fff").unwrap().g, 255);
        assert_eq!(parse_hex("#00000080").unwrap().a, 128);
        assert!(parse_hex("#12345").is_err());
        assert!(parse_paint("not_a_role").is_err());
        let bad = MaterialDef {
            roughness: 2.0,
            ..MaterialDef::default()
        };
        assert!(bad.to_material().is_err());
    }
}
