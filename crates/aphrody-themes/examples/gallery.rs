// SPDX-License-Identifier: Apache-2.0
//! Renders one egui window per theme and scheme to PNG (offscreen, wgpu): `cargo run -p aphrody-themes --features egui --example gallery -- <outdir>`.
use aphrody_themes::{
    Scheme, ThemeId,
    config::{SchemeChoice, Selection},
    egui_theme::apply,
};
use egui_kittest::Harness;

fn ui(ui: &mut egui::Ui, theme: ThemeId, scheme: Scheme) {
    let (_, _, p) = aphrody_themes::egui_theme::resolved(
        &Selection {
            theme: theme.as_str().into(),
            scheme: if scheme == Scheme::Dark {
                SchemeChoice::Dark
            } else {
                SchemeChoice::Light
            },
            accent: theme.meta().default_accent.into(),
            transparency: None,
        },
        false,
    );
    egui::Frame::NONE
        .fill(ui.visuals().panel_fill)
        .inner_margin(16.0)
        .show(ui, |ui| {
            ui.set_min_size(ui.available_size());
            ui.heading(theme.meta().name);
            ui.label("Body text on the theme background.");
            ui.small("Caption text, secondary.");
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                let _ = ui.button("Default");
                ui.add(
                    egui::Button::new(
                        egui::RichText::new("Accent")
                            .color(aphrody_themes::egui_theme::color(p.on_accent)),
                    )
                    .fill(aphrody_themes::egui_theme::color(p.accent)),
                );
                let _ = ui.checkbox(&mut true, "Checked");
            });
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                let mut v = 0.6f32;
                ui.add(egui::Slider::new(&mut v, 0.0..=1.0));
                let mut t = "Text field".to_string();
                ui.add(egui::TextEdit::singleline(&mut t).desired_width(120.0));
            });
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.selectable_value(&mut 1, 1, "Selected");
                ui.selectable_value(&mut 1, 2, "Other");
                ui.hyperlink_to("Link", "https://bun.com");
            });
        });
}

fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "gallery".into()));
    std::fs::create_dir_all(&out).unwrap();
    for theme in ThemeId::ALL {
        for scheme in [Scheme::Light, Scheme::Dark] {
            let sel = Selection {
                theme: theme.as_str().into(),
                scheme: if scheme == Scheme::Dark {
                    SchemeChoice::Dark
                } else {
                    SchemeChoice::Light
                },
                accent: theme.meta().default_accent.into(),
                transparency: None,
            };
            let mut harness = Harness::builder()
                .with_size(egui::vec2(440.0, 280.0))
                .wgpu()
                .build_ui(move |u| ui(u, theme, scheme));
            apply(&harness.ctx, &sel, false, false);
            harness.run();
            let img = harness.render().expect("wgpu render");
            let path = out.join(format!("egui-{}-{}.png", theme.as_str(), scheme.as_str()));
            img.save(&path).unwrap();
            println!("{}", path.display());
        }
    }
}
