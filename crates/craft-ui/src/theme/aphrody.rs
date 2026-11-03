// SPDX-License-Identifier: Apache-2.0
//! The egui adapter for the canonical M3 framework and Aphrody identity.
//!
//! Only application chrome belongs here. Document, media and diagnostic colors
//! remain owned by each editor. Schemes are cached rather than generated per frame.

use std::sync::OnceLock;

use aphrody_m3::theme::Theme;
use aphrody_m3_tokens::scheme::DynamicScheme;
pub use aphrody_m3_tokens::scheme::Role;
use aphrody_m3_tokens::{blend, elevation, spaceui, state};
use egui::{Color32, Shadow, Stroke, Visuals, style::Selection};

use super::shape;

pub struct Palette {
    scheme: DynamicScheme,
    colors: [(Role, Color32); Role::ALL.len()],
    warning: Color32,
}

impl Palette {
    pub fn get(dark: bool, high_contrast: bool) -> &'static Self {
        static LIGHT: OnceLock<Palette> = OnceLock::new();
        static DARK: OnceLock<Palette> = OnceLock::new();
        static LIGHT_CONTRAST: OnceLock<Palette> = OnceLock::new();
        static DARK_CONTRAST: OnceLock<Palette> = OnceLock::new();
        let slot = match (dark, high_contrast) {
            (false, false) => &LIGHT,
            (true, false) => &DARK,
            (false, true) => &LIGHT_CONTRAST,
            (true, true) => &DARK_CONTRAST,
        };
        slot.get_or_init(|| {
            let request = Theme::aphrody_request();
            let request = if high_contrast {
                request.high_contrast()
            } else {
                request
            };
            let scheme = request.scheme(dark);
            let colors = std::array::from_fn(|index| {
                let role = Role::ALL[index];
                (role, color32(scheme.argb(role)))
            });
            Self {
                scheme,
                colors,
                warning: extended(request.seed(), "warning", dark),
            }
        })
    }

    pub fn color(&self, role: Role) -> Color32 {
        self.colors
            .iter()
            .find_map(|(candidate, color)| (*candidate == role).then_some(*color))
            .unwrap_or_else(|| color32(self.scheme.argb(role)))
    }

    /// The M3 extended `warning` role, harmonized toward the scheme seed.
    pub fn warning(&self) -> Color32 {
        self.warning
    }

    pub fn is_dark(&self) -> bool {
        self.scheme.is_dark
    }
}

/// An extended role (`--md-ext-color-<name>`) from the canonical extended seeds.
fn extended(seed: u32, name: &str, dark: bool) -> Color32 {
    let value = spaceui::EXTENDED
        .iter()
        .find_map(|(candidate, value)| (*candidate == name).then_some(*value))
        .expect("the canonical extended roles include success and warning");
    let custom = blend::custom_color(seed, value, true);
    color32(if dark { custom.dark } else { custom.light }.color)
}

/// The only ARGB-to-egui conversion: the canonical engine emits opaque roles.
fn color32(argb: u32) -> Color32 {
    let [_, r, g, b] = argb.to_be_bytes();
    Color32::from_rgb(r, g, b)
}

/// A state layer of `content` at `layer` opacity over `container` (M3 interaction states).
fn state_layer(container: Color32, content: Color32, layer: state::StateLayer) -> Color32 {
    container.lerp_to_gamma(content, layer.opacity)
}

/// Every chrome colour a Craft frontend paints, resolved once from the canonical palette.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
    pub dark: bool,
    pub high_contrast: bool,
    /// Panels and the application background (`surface`).
    pub panel_fill: Color32,
    /// Windows, dialogs and popups (`surface-container`).
    pub window_fill: Color32,
    /// Text fields and scroll tracks (`surface-container-lowest`).
    pub extreme_bg: Color32,
    /// Striped rows (`surface-container-low`).
    pub faint_bg: Color32,
    /// Code spans and raised controls (`surface-container-highest`).
    pub code_bg: Color32,
    /// The dock, shelf and floating toolbars (`surface-container-high`).
    pub dock: Color32,
    pub text: Color32,
    pub text_variant: Color32,
    pub selection_bg: Color32,
    pub selection_fg: Color32,
    pub hyperlink: Color32,
    pub warn: Color32,
    pub error: Color32,
    pub outline: Color32,
    pub outline_variant: Color32,
    /// The focus indicator (`secondary`).
    pub focus: Color32,
    /// Accent borders of the selected item (`primary`).
    pub accent_border: Color32,
    /// The window close control on hover (`error` / `on-error`).
    pub caption_close: Color32,
    pub on_caption_close: Color32,
    /// Modal dimming base (`scrim`); the dim opacity is applied by the material layer.
    pub scrim: Color32,
    /// Ambient elevation layer (`shadow` at the elevation ambient alpha).
    pub window_shadow: Color32,
}

impl Tokens {
    pub fn get(dark: bool, high_contrast: bool) -> Self {
        Self::from_palette(Palette::get(dark, high_contrast), high_contrast)
    }

    pub fn from_palette(palette: &Palette, high_contrast: bool) -> Self {
        let c = |role| palette.color(role);
        Self {
            dark: palette.is_dark(),
            high_contrast,
            panel_fill: c(Role::Surface),
            window_fill: c(Role::SurfaceContainer),
            extreme_bg: c(Role::SurfaceContainerLowest),
            faint_bg: c(Role::SurfaceContainerLow),
            code_bg: c(Role::SurfaceContainerHighest),
            dock: c(Role::SurfaceContainerHigh),
            text: c(Role::OnSurface),
            text_variant: c(Role::OnSurfaceVariant),
            selection_bg: c(Role::SecondaryContainer),
            selection_fg: c(Role::OnSecondaryContainer),
            hyperlink: c(Role::Primary),
            warn: palette.warning(),
            error: c(Role::Error),
            outline: c(Role::Outline),
            outline_variant: c(Role::OutlineVariant),
            focus: c(Role::Secondary),
            accent_border: c(Role::Primary),
            caption_close: c(Role::Error),
            on_caption_close: c(Role::OnError),
            scrim: c(Role::Scrim),
            window_shadow: c(Role::Shadow).gamma_multiply(elevation::AMBIENT_ALPHA),
        }
    }

    /// The complete egui visuals of these tokens: surfaces, text, selection, state layers,
    /// shadows and the M3 corner roles.
    pub fn visuals(&self) -> Visuals {
        let mut visuals = if self.dark {
            Visuals::dark()
        } else {
            Visuals::light()
        };
        visuals.dark_mode = self.dark;
        visuals.override_text_color = None;
        visuals.panel_fill = self.panel_fill;
        visuals.window_fill = self.window_fill;
        visuals.extreme_bg_color = self.extreme_bg;
        visuals.faint_bg_color = self.faint_bg;
        visuals.code_bg_color = self.code_bg;
        visuals.text_edit_bg_color = Some(self.extreme_bg);
        visuals.hyperlink_color = self.hyperlink;
        visuals.warn_fg_color = self.warn;
        visuals.error_fg_color = self.error;
        visuals.weak_text_color = Some(self.text_variant);
        visuals.selection = Selection {
            bg_fill: self.selection_bg,
            stroke: Stroke::new(1.0, self.selection_fg),
        };
        visuals.text_cursor.stroke = Stroke::new(2.0, self.accent_border);
        visuals.window_stroke = Stroke::new(1.0, self.outline_variant);
        visuals.window_corner_radius = shape::WINDOW;
        visuals.menu_corner_radius = shape::MENU;
        visuals.window_shadow = shadow(self.window_shadow, 3);
        visuals.popup_shadow = shadow(self.window_shadow, 2);
        visuals.disabled_alpha = state::DISABLED_CONTENT.opacity;

        let border = if self.high_contrast {
            self.outline
        } else {
            self.outline_variant
        };
        let control = self.code_bg;
        let widgets = &mut visuals.widgets;
        widgets.noninteractive.bg_fill = self.window_fill;
        widgets.noninteractive.weak_bg_fill = self.window_fill;
        widgets.noninteractive.bg_stroke = Stroke::new(1.0, self.outline_variant);
        widgets.noninteractive.fg_stroke = Stroke::new(1.0, self.text_variant);
        widgets.inactive.bg_fill = control;
        widgets.inactive.weak_bg_fill = control;
        widgets.inactive.bg_stroke = Stroke::new(1.0, border);
        widgets.inactive.fg_stroke = Stroke::new(1.0, self.text);
        widgets.hovered.bg_fill = state_layer(control, self.text, state::HOVER);
        widgets.hovered.weak_bg_fill = widgets.hovered.bg_fill;
        widgets.hovered.bg_stroke = Stroke::new(1.0, self.outline);
        widgets.hovered.fg_stroke = Stroke::new(1.5, self.text);
        widgets.active.bg_fill = state_layer(control, self.text, state::PRESSED);
        widgets.active.weak_bg_fill = widgets.active.bg_fill;
        widgets.active.bg_stroke = Stroke::new(
            aphrody_m3_tokens::component::focus_indicator::THICKNESS,
            self.focus,
        );
        widgets.active.fg_stroke = Stroke::new(2.0, self.text);
        widgets.open.bg_fill = self.selection_bg;
        widgets.open.weak_bg_fill = self.selection_bg;
        widgets.open.bg_stroke = Stroke::new(1.0, self.outline);
        widgets.open.fg_stroke = Stroke::new(1.0, self.selection_fg);
        shape::apply_control_to_visuals(&mut visuals);
        visuals
    }
}

/// The ambient layer of an M3 elevation level (1..=5) as an egui shadow.
fn shadow(color: Color32, level: usize) -> Shadow {
    let layer = elevation::SHADOWS[level - 1][1];
    Shadow {
        offset: [0, i8::try_from(layer.y).unwrap_or(i8::MAX)],
        blur: layer.blur,
        spread: layer.spread,
        color,
    }
}

/// The Bun OS product visuals for egui hosts at the given mode and contrast.
pub fn visuals(dark: bool, high_contrast: bool) -> Visuals {
    Tokens::get(dark, high_contrast).visuals()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visuals_follow_the_canonical_roles() {
        for dark in [false, true] {
            for high_contrast in [false, true] {
                let palette = Palette::get(dark, high_contrast);
                let visuals = visuals(dark, high_contrast);
                assert_eq!(visuals.dark_mode, dark);
                assert_eq!(visuals.panel_fill, palette.color(Role::Surface));
                assert_eq!(visuals.window_fill, palette.color(Role::SurfaceContainer));
                assert_eq!(
                    visuals.extreme_bg_color,
                    palette.color(Role::SurfaceContainerLowest)
                );
                assert_eq!(
                    visuals.selection.bg_fill,
                    palette.color(Role::SecondaryContainer)
                );
                assert_eq!(visuals.hyperlink_color, palette.color(Role::Primary));
                assert_eq!(visuals.error_fg_color, palette.color(Role::Error));
                assert_ne!(
                    visuals.widgets.hovered.bg_fill,
                    visuals.widgets.inactive.bg_fill
                );
                assert_ne!(
                    visuals.widgets.active.bg_fill,
                    visuals.widgets.hovered.bg_fill
                );
            }
        }
    }

    #[test]
    fn high_contrast_changes_the_scheme() {
        assert_ne!(
            Palette::get(true, false).color(Role::OnSurfaceVariant),
            Palette::get(true, true).color(Role::OnSurfaceVariant)
        );
    }
}
