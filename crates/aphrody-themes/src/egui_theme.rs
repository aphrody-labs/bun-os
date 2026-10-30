// SPDX-License-Identifier: Apache-2.0
//! egui Visuals and Style for the three themes. Replaces the per-app themes of the craft apps: an app calls
//! [`apply`] with the shared [`Selection`] (see [`crate::config`]) and re-calls it when the file changes.
//!
//! Fonts are not installed here (apps own their font definitions); text sizes, spacing and rounding follow the
//! theme's type ramp and shape tokens. egui cannot blur what is behind a surface, so glass surfaces are the
//! glass tint composited over the window background; on a transparent Tauri/winit window with a native effect
//! (see [`crate::window_settings`]) the app can use the alpha glass color directly via [`glass_fill`].

use egui::{
    Color32, CornerRadius, FontFamily, FontId, Stroke, Style, TextStyle as EguiText, Visuals,
    epaint::Shadow, style::WidgetVisuals,
};

use crate::{Palette, Rgba, Scheme, ThemeId, ThemeMeta, config::Selection, palette};

pub fn color(c: Rgba) -> Color32 {
    Color32::from_rgba_unmultiplied(c.r, c.g, c.b, c.a)
}

fn radius(px: f32) -> CornerRadius {
    CornerRadius::same(px.round().clamp(0.0, 255.0) as u8)
}

/// The palette the selection resolves to, with the Liquid Glass slider applied to the glass alpha.
pub fn resolved(sel: &Selection, system_dark: bool) -> (ThemeId, Scheme, Palette) {
    let theme = sel.theme_id();
    let scheme = sel.scheme.resolve(system_dark);
    let mut p = *palette(theme, scheme, &sel.accent)
        .or_else(|| palette(theme, scheme, theme.meta().default_accent))
        .expect("default accent exists");
    if let Some(t) = sel.transparency {
        p.glass = p.glass_tint.scale_alpha(0.04 + 0.96 * t);
    }
    (theme, scheme, p)
}

/// Fill for a glass surface drawn over `backdrop` (the window background when nothing is behind the window).
pub fn glass_fill(p: &Palette, backdrop: Rgba) -> Color32 {
    color(p.glass.over(backdrop))
}

fn widget(
    fill: Rgba,
    stroke: Option<(f32, Rgba)>,
    fg: Rgba,
    r: CornerRadius,
    expansion: f32,
) -> WidgetVisuals {
    WidgetVisuals {
        bg_fill: color(fill),
        weak_bg_fill: color(fill),
        bg_stroke: stroke.map_or(Stroke::NONE, |(w, c)| Stroke::new(w, color(c))),
        corner_radius: r,
        fg_stroke: Stroke::new(1.0, color(fg)),
        expansion,
    }
}

pub fn visuals(theme: ThemeId, scheme: Scheme, p: &Palette) -> Visuals {
    let meta = theme.meta();
    let mut v = if scheme == Scheme::Dark {
        Visuals::dark()
    } else {
        Visuals::light()
    };
    let ctl = radius(meta.radii.control);
    let surface = p.surface.over(p.bg);
    // M3 fills controls with a tonal surface and has no outline; Fluent and Apple draw a hairline.
    let hairline = theme != ThemeId::M3;
    let ctl_fill = |c: Rgba| c.over(surface);
    let stroke = |c: Rgba| {
        if hairline {
            Some((1.0, c.over(surface)))
        } else {
            None
        }
    };
    v.widgets.noninteractive = widget(
        surface,
        Some((1.0, p.divider.over(surface))),
        p.fg.over(surface),
        ctl,
        0.0,
    );
    v.widgets.inactive = widget(
        ctl_fill(p.control),
        stroke(p.border),
        p.fg.over(surface),
        ctl,
        0.0,
    );
    v.widgets.hovered = widget(
        ctl_fill(p.control_hover),
        stroke(p.border_strong),
        p.fg.over(surface),
        ctl,
        0.0,
    );
    v.widgets.active = widget(
        p.control_pressed.over(surface),
        Some((1.0, p.accent)),
        p.fg.over(surface),
        ctl,
        0.0,
    );
    v.widgets.open = widget(
        ctl_fill(p.control),
        stroke(p.border),
        p.fg.over(surface),
        ctl,
        0.0,
    );
    v.selection.bg_fill = color(p.selection.over(p.bg));
    v.selection.stroke = Stroke::new(1.0, color(p.accent));
    v.hyperlink_color = color(p.accent);
    v.faint_bg_color = color(p.bg_alt);
    v.extreme_bg_color = color(p.control.over(p.bg_alt).over(p.bg));
    v.text_edit_bg_color = Some(color(p.control.over(surface)));
    v.code_bg_color = color(p.bg_alt);
    v.warn_fg_color = color(p.warning);
    v.error_fg_color = color(p.danger);
    v.panel_fill = color(p.bg);
    v.window_fill = if theme == ThemeId::Apple {
        color(p.glass.over(p.bg))
    } else {
        color(p.surface_raised.over(p.bg))
    };
    v.window_stroke = Stroke::new(
        1.0,
        color(if theme == ThemeId::Apple {
            p.glass_border.over(p.bg)
        } else {
            p.border.over(p.bg)
        }),
    );
    v.window_corner_radius = radius(meta.radii.container);
    v.menu_corner_radius = radius(meta.radii.lg.min(meta.radii.container));
    let shadow = |blur: u8| Shadow {
        offset: [0, blur as i8 / 3],
        blur,
        spread: 0,
        color: color(p.shadow),
    };
    v.window_shadow = shadow(24);
    v.popup_shadow = shadow(16);
    v.text_cursor.stroke = Stroke::new(2.0, color(p.accent));
    v
}

fn text_style_map(meta: &ThemeMeta, touch: bool) -> [(EguiText, &'static str); 5] {
    let _ = touch;
    match meta.id {
        ThemeId::M3 => [
            (EguiText::Heading, "title-large"),
            (EguiText::Body, "body-medium"),
            (EguiText::Button, "label-large"),
            (EguiText::Small, "label-small"),
            (EguiText::Monospace, "body-medium"),
        ],
        ThemeId::Fluent => [
            (EguiText::Heading, "subtitle"),
            (EguiText::Body, "body"),
            (EguiText::Button, "body"),
            (EguiText::Small, "caption"),
            (EguiText::Monospace, "body"),
        ],
        ThemeId::Apple => [
            (EguiText::Heading, "title2"),
            (EguiText::Body, "body"),
            (EguiText::Button, "body"),
            (EguiText::Small, "caption1"),
            (EguiText::Monospace, "body"),
        ],
    }
}

/// `touch` selects the iOS text styles (17pt body) for Apple instead of the macOS ones (13pt).
pub fn style(theme: ThemeId, scheme: Scheme, p: &Palette, touch: bool) -> Style {
    let meta = theme.meta();
    let mut s = Style {
        visuals: visuals(theme, scheme, p),
        ..Style::default()
    };
    let ramp = if theme == ThemeId::Apple && !touch {
        meta.ramp_desktop
    } else {
        meta.ramp
    };
    for (slot, name) in text_style_map(meta, touch) {
        if let Some((_, t)) = ramp.iter().find(|(n, _)| *n == name) {
            let family = if slot == EguiText::Monospace {
                FontFamily::Monospace
            } else {
                FontFamily::Proportional
            };
            s.text_styles.insert(slot, FontId::new(t.size, family));
        }
    }
    let (pad_x, pad_y, min_h) = match theme {
        ThemeId::M3 => (24.0, 10.0, 40.0),
        ThemeId::Fluent => (16.0, 5.0, 32.0),
        ThemeId::Apple if touch => (20.0, 10.0, 44.0),
        ThemeId::Apple => (14.0, 5.0, 28.0),
    };
    s.spacing.button_padding = egui::vec2(pad_x, pad_y);
    s.spacing.interact_size.y = min_h;
    s.spacing.item_spacing = egui::vec2(8.0, if theme == ThemeId::Fluent { 6.0 } else { 8.0 });
    s.animation_time = meta.motion.normal_ms / 1000.0;
    s
}

/// Applies the selection to a context: both light and dark styles are set so egui's own theme switch stays
/// consistent, and the active one follows the resolved scheme.
pub fn apply(ctx: &egui::Context, sel: &Selection, system_dark: bool, touch: bool) {
    let (theme, scheme, p) = resolved(sel, system_dark);
    ctx.set_theme(if scheme == Scheme::Dark {
        egui::Theme::Dark
    } else {
        egui::Theme::Light
    });
    let st = style(theme, scheme, &p, touch);
    ctx.set_style_of(
        if scheme == Scheme::Dark {
            egui::Theme::Dark
        } else {
            egui::Theme::Light
        },
        st,
    );
}
