//! Material 3 role colours of the native shell (feature `shell`).
//!
//! The roles come from `docs/bun-engine/design/tokens.json`, the same file the web frontend
//! (`packages/bun-engine/web/app/frontend.css`) is checked against. The JSON is embedded at build
//! time and parsed once; no palette value is written in Rust. The `m3` table of that file maps each
//! role to its `--md-sys-color-*` token (`accent` is `tertiary`, `text` is `on-surface`, ...); the
//! values here are the dark fallbacks, as in the web frontend.

use std::{collections::HashMap, sync::OnceLock};

use crate::bevy::color::{Alpha, Color};

const TOKENS: &str = include_str!("../../../../docs/bun-engine/design/tokens.json");

/// A colour role of `tokens.json`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    /// `background`
    Bg,
    /// `surface-container`
    Surface,
    /// `surface-container-high`
    SurfaceHigh,
    /// `outline-variant`
    Border,
    /// `on-surface`
    Text,
    /// `on-surface-variant`
    TextMuted,
    /// `tertiary`: the focus ring and the primary action.
    Accent,
    /// Text on the accent role.
    OnAccent,
    /// `error`
    Danger,
    /// `primary`
    Success,
    Warning,
}

impl Role {
    /// Key in `tokens.json` `color`.
    fn key(self) -> &'static str {
        match self {
            Role::Bg => "bg",
            Role::Surface => "surface",
            Role::SurfaceHigh => "surface-high",
            Role::Border => "border",
            Role::Text => "text",
            Role::TextMuted => "text-muted",
            Role::Accent => "accent",
            Role::OnAccent => "on-accent",
            Role::Danger => "danger",
            Role::Success => "success",
            Role::Warning => "warning",
        }
    }
}

fn parse_hex(hex: &str) -> Option<Color> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some(Color::srgb_u8(channel(0)?, channel(2)?, channel(4)?))
}

fn table() -> &'static HashMap<String, Color> {
    static TABLE: OnceLock<HashMap<String, Color>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let json: serde_json::Value = serde_json::from_str(TOKENS).expect("tokens.json is valid JSON");
        json["color"]
            .as_object()
            .expect("tokens.json has a `color` table")
            .iter()
            .filter_map(|(name, value)| Some((name.clone(), parse_hex(value.as_str()?)?)))
            .collect()
    })
}

/// The colour of `role` (dark fallback of the Material 3 role).
pub fn color(role: Role) -> Color {
    *table()
        .get(role.key())
        .unwrap_or_else(|| panic!("tokens.json has no `{}` colour", role.key()))
}

/// `role` with an alpha, for scrims and translucent panels.
pub fn color_alpha(role: Role, alpha: f32) -> Color {
    color(role).with_alpha(alpha)
}
