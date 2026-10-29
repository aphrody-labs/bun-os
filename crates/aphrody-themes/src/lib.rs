// SPDX-License-Identifier: Apache-2.0
//! Bun OS themes in Rust: Material 3 (Google Book OS), Windows 11 Fluent and Apple Liquid Glass.
//!
//! Everything numeric lives in `generated.rs`, produced by `packages/themes` from the W3C design-token files
//! in `packages/themes/tokens`; edit the tokens and run `bun packages/themes/src/build.ts`, never this data.
//! This file adds the types, lookups, the Tauri window-effect settings, the shared selection file
//! ([`config`]) and, behind the `egui` feature, Visuals and Style per theme ([`egui_theme`]).

pub mod config;
#[cfg(feature = "egui")]
pub mod egui_theme;
mod generated;

pub use generated::{METAS, PALETTES};

/// sRGB color with straight (non-premultiplied) alpha.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    /// `#RRGGBB`, or `#RRGGBBAA` when not opaque (same text as the generated CSS and tokens).
    pub fn hex(self) -> String {
        if self.a == 255 {
            format!("#{:02X}{:02X}{:02X}", self.r, self.g, self.b)
        } else {
            format!("#{:02X}{:02X}{:02X}{:02X}", self.r, self.g, self.b, self.a)
        }
    }

    /// This color with its alpha multiplied by `k` (0..=1).
    pub fn scale_alpha(self, k: f32) -> Self {
        Self { a: (f32::from(self.a) * k.clamp(0.0, 1.0)).round() as u8, ..self }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ThemeId {
    M3,
    Fluent,
    Apple,
}

impl ThemeId {
    pub const ALL: [ThemeId; 3] = [ThemeId::M3, ThemeId::Fluent, ThemeId::Apple];

    pub fn as_str(self) -> &'static str {
        match self {
            ThemeId::M3 => "m3",
            ThemeId::Fluent => "fluent",
            ThemeId::Apple => "apple",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.as_str() == s)
    }

    pub fn meta(self) -> &'static ThemeMeta {
        METAS.iter().copied().find(|m| m.id == self).expect("generated metadata covers every theme")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scheme {
    Light,
    Dark,
}

impl Scheme {
    pub fn as_str(self) -> &'static str {
        match self {
            Scheme::Light => "light",
            Scheme::Dark => "dark",
        }
    }
}

/// The semantic color contract shared by every theme (the CSS `--t-*` variables).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Palette {
    pub bg: Rgba,
    pub bg_alt: Rgba,
    pub surface: Rgba,
    pub surface_raised: Rgba,
    pub layer: Rgba,
    pub fg: Rgba,
    pub fg_muted: Rgba,
    pub fg_subtle: Rgba,
    pub fg_disabled: Rgba,
    pub border: Rgba,
    pub border_strong: Rgba,
    pub divider: Rgba,
    pub control: Rgba,
    pub control_hover: Rgba,
    pub control_pressed: Rgba,
    pub accent: Rgba,
    pub accent_hover: Rgba,
    pub accent_pressed: Rgba,
    pub on_accent: Rgba,
    pub accent_container: Rgba,
    pub on_accent_container: Rgba,
    pub danger: Rgba,
    pub on_danger: Rgba,
    pub warning: Rgba,
    pub success: Rgba,
    pub focus: Rgba,
    pub selection: Rgba,
    pub scrim: Rgba,
    pub shadow: Rgba,
    pub glass_tint: Rgba,
    pub glass: Rgba,
    pub glass_border: Rgba,
    pub glass_highlight: Rgba,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Radii {
    pub none: f32,
    pub sm: f32,
    pub md: f32,
    pub lg: f32,
    pub xl: f32,
    pub full: f32,
    pub control: f32,
    pub container: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextStyle {
    pub size: f32,
    pub line: f32,
    pub weight: u16,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Motion {
    pub fast_ms: f32,
    pub normal_ms: f32,
    pub slow_ms: f32,
    pub easing: [f32; 4],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Glass {
    pub blur: f32,
    pub saturate: f32,
    pub opacity_light: f32,
    pub opacity_dark: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Controls {
    TrafficLights,
    Caption,
    M3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fonts {
    pub ui: &'static str,
    pub display: &'static str,
    pub mono: &'static str,
}

/// Tauri `WindowEffect` names (camelCase, tauri-utils) per operating system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowEffects {
    pub windows: &'static [&'static str],
    pub macos: &'static [&'static str],
    pub other: &'static [&'static str],
}

pub struct ThemeMeta {
    pub id: ThemeId,
    pub name: &'static str,
    pub accents: &'static [&'static str],
    pub default_accent: &'static str,
    pub radii: Radii,
    pub fonts: Fonts,
    pub ramp: &'static [(&'static str, TextStyle)],
    /// Apple only: macOS text styles for pointer devices; empty for the other themes.
    pub ramp_desktop: &'static [(&'static str, TextStyle)],
    pub motion: Motion,
    pub glass: Glass,
    pub controls: Controls,
    pub window_effects: WindowEffects,
}

impl ThemeMeta {
    pub fn text(&self, name: &str) -> Option<TextStyle> {
        self.ramp.iter().find(|(n, _)| *n == name).map(|(_, t)| *t)
    }
}

/// The resolved palette of one combination; `None` when the accent does not exist in the theme.
pub fn palette(theme: ThemeId, scheme: Scheme, accent: &str) -> Option<&'static Palette> {
    PALETTES.iter().find(|(t, s, a, _)| *t == theme && *s == scheme && *a == accent).map(|(_, _, _, p)| *p)
}

/// Operating system families that differ in window effects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Windows,
    Macos,
    Other,
}

impl Os {
    pub const fn current() -> Self {
        if cfg!(target_os = "windows") {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Other
        }
    }
}

/// The settings a Tauri window needs for a theme on `os`: ready to merge into `tauri.conf.json` (`windowEffects`
/// plus `transparent`) or to apply at runtime with `WebviewWindow::set_effects`.
/// `transparent` is also true for the Apple theme on Windows and Linux, where the CSS `backdrop-filter` glass
/// (`.t-glass` in `themes.css`) replaces a native effect.
pub fn window_settings(theme: ThemeId, os: Os) -> serde_json::Value {
    let meta = theme.meta();
    let effects = match os {
        Os::Windows => meta.window_effects.windows,
        Os::Macos => meta.window_effects.macos,
        Os::Other => meta.window_effects.other,
    };
    let css_glass = theme == ThemeId::Apple;
    let mut cfg = serde_json::json!({ "effects": effects });
    if os == Os::Macos && !effects.is_empty() {
        cfg["radius"] = meta.radii.container.into();
        cfg["state"] = "followsWindowActiveState".into();
        cfg["interactive"] = (theme == ThemeId::Apple).into();
    }
    serde_json::json!({
        "transparent": !effects.is_empty() || css_glass,
        "windowEffects": if effects.is_empty() { serde_json::Value::Null } else { cfg },
        "titleBarStyle": if theme == ThemeId::Apple && os == Os::Macos { "Overlay" } else { "Visible" },
        "cssGlassFallback": css_glass && effects.is_empty(),
    })
}

impl Palette {
    /// Every slot with its token name (the camelCase names of `packages/themes`, `--t-*` in kebab-case in CSS).
    pub fn slots(&self) -> [(&'static str, Rgba); 33] {
        [
            ("bg", self.bg),
            ("bgAlt", self.bg_alt),
            ("surface", self.surface),
            ("surfaceRaised", self.surface_raised),
            ("layer", self.layer),
            ("fg", self.fg),
            ("fgMuted", self.fg_muted),
            ("fgSubtle", self.fg_subtle),
            ("fgDisabled", self.fg_disabled),
            ("border", self.border),
            ("borderStrong", self.border_strong),
            ("divider", self.divider),
            ("control", self.control),
            ("controlHover", self.control_hover),
            ("controlPressed", self.control_pressed),
            ("accent", self.accent),
            ("accentHover", self.accent_hover),
            ("accentPressed", self.accent_pressed),
            ("onAccent", self.on_accent),
            ("accentContainer", self.accent_container),
            ("onAccentContainer", self.on_accent_container),
            ("danger", self.danger),
            ("onDanger", self.on_danger),
            ("warning", self.warning),
            ("success", self.success),
            ("focus", self.focus),
            ("selection", self.selection),
            ("scrim", self.scrim),
            ("shadow", self.shadow),
            ("glassTint", self.glass_tint),
            ("glass", self.glass),
            ("glassBorder", self.glass_border),
            ("glassHighlight", self.glass_highlight),
        ]
    }
}

impl Rgba {
    /// `self` painted over `below` (source-over), result opaque when `below` is.
    pub fn over(self, below: Rgba) -> Rgba {
        let a = f32::from(self.a) / 255.0;
        let b = f32::from(below.a) / 255.0;
        let out = a + b * (1.0 - a);
        if out <= 0.0 {
            return Rgba::new(0, 0, 0, 0);
        }
        let mix = |t: u8, u: u8| ((f32::from(t) * a + f32::from(u) * b * (1.0 - a)) / out).round() as u8;
        Rgba::new(mix(self.r, below.r), mix(self.g, below.g), mix(self.b, below.b), (out * 255.0).round() as u8)
    }
}
