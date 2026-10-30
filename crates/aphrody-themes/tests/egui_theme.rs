// SPDX-License-Identifier: Apache-2.0
use aphrody_themes::{
    Scheme, ThemeId,
    config::{SchemeChoice, Selection},
    egui_theme::{apply, color, resolved, style},
    palette,
};

#[test]
fn visuals_use_the_palette_for_every_theme_scheme_and_accent() {
    for theme in ThemeId::ALL {
        for scheme in [Scheme::Light, Scheme::Dark] {
            for accent in theme.meta().accents {
                let p = palette(theme, scheme, accent).unwrap();
                let st = style(theme, scheme, p, false);
                let v = &st.visuals;
                assert_eq!(v.dark_mode, scheme == Scheme::Dark);
                assert_eq!(v.panel_fill, color(p.bg), "{theme:?} {accent}");
                assert_eq!(v.selection.stroke.color, color(p.accent));
                assert_eq!(v.widgets.active.bg_stroke.color, color(p.accent));
                assert_eq!(v.error_fg_color, color(p.danger));
                assert_eq!(
                    v.window_corner_radius.nw as f32,
                    theme.meta().radii.container.min(255.0)
                );
            }
        }
    }
}

#[test]
fn text_sizes_come_from_the_type_ramp() {
    let p = palette(ThemeId::Fluent, Scheme::Light, "blue").unwrap();
    let st = style(ThemeId::Fluent, Scheme::Light, p, false);
    assert_eq!(st.text_styles[&egui::TextStyle::Body].size, 14.0);
    assert_eq!(st.text_styles[&egui::TextStyle::Heading].size, 20.0);
    let pa = palette(ThemeId::Apple, Scheme::Light, "blue").unwrap();
    assert_eq!(
        style(ThemeId::Apple, Scheme::Light, pa, false).text_styles[&egui::TextStyle::Body].size,
        13.0
    );
    assert_eq!(
        style(ThemeId::Apple, Scheme::Light, pa, true).text_styles[&egui::TextStyle::Body].size,
        17.0
    );
}

#[test]
fn transparency_slider_scales_glass_alpha_and_auto_follows_the_system() {
    let mut sel = Selection {
        theme: "apple".into(),
        scheme: SchemeChoice::Auto,
        accent: "blue".into(),
        transparency: Some(0.0),
    };
    let (_, scheme, clear) = resolved(&sel, true);
    assert_eq!(scheme, Scheme::Dark);
    sel.transparency = Some(1.0);
    let (_, _, tinted) = resolved(&sel, true);
    assert_eq!(clear.glass.a, 10); // 0.04 * 255
    assert_eq!(tinted.glass.a, 255);
    assert_eq!(resolved(&sel, false).1, Scheme::Light);
}

#[test]
fn apply_sets_the_context_theme() {
    let ctx = egui::Context::default();
    let sel = Selection {
        theme: "fluent".into(),
        scheme: SchemeChoice::Dark,
        accent: "blue".into(),
        transparency: None,
    };
    apply(&ctx, &sel, false, false);
    assert_eq!(ctx.theme(), egui::Theme::Dark);
    assert_eq!(
        ctx.style_of(egui::Theme::Dark).visuals.panel_fill,
        color(palette(ThemeId::Fluent, Scheme::Dark, "blue").unwrap().bg)
    );
}
