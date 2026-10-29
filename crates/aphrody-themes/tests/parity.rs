// SPDX-License-Identifier: Apache-2.0
//! The Rust palettes and the TypeScript build come from the same tokens: prove they agree on every slot of every
//! theme, scheme and accent by reading `packages/themes/generated/resolved.json`.

use aphrody_themes::{Os, Scheme, ThemeId, config::Selection, palette, window_settings};

fn resolved() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/themes/generated/resolved.json"
    );
    serde_json::from_str(
        &std::fs::read_to_string(path).expect("run `bun packages/themes/src/build.ts`"),
    )
    .unwrap()
}

#[test]
fn every_palette_slot_matches_the_typescript_build() {
    let json = resolved();
    let mut checked = 0;
    for theme in ThemeId::ALL {
        for scheme in [Scheme::Light, Scheme::Dark] {
            let accents = json["colors"][theme.as_str()][scheme.as_str()]
                .as_object()
                .unwrap();
            assert_eq!(
                accents.len(),
                theme.meta().accents.len(),
                "{theme:?} accent count"
            );
            for (accent, slots) in accents {
                let p = palette(theme, scheme, accent)
                    .unwrap_or_else(|| panic!("{theme:?}/{scheme:?}/{accent} missing in Rust"));
                for (name, rgba) in p.slots() {
                    assert_eq!(
                        slots[name].as_str().unwrap(),
                        rgba.hex(),
                        "{theme:?}/{scheme:?}/{accent}/{name}"
                    );
                    checked += 1;
                }
            }
        }
    }
    assert_eq!(checked, 3 * 2 * 8 * 33);
}

#[test]
fn metadata_matches_the_typescript_build() {
    let json = resolved();
    for theme in ThemeId::ALL {
        let meta = theme.meta();
        let t = &json["themes"][theme.as_str()];
        assert_eq!(meta.name, t["name"].as_str().unwrap());
        assert_eq!(meta.default_accent, t["defaultAccent"].as_str().unwrap());
        assert_eq!(
            f64::from(meta.radii.control),
            t["shape"]["control"].as_f64().unwrap()
        );
        assert_eq!(
            f64::from(meta.radii.container),
            t["shape"]["container"].as_f64().unwrap()
        );
        for (name, style) in meta.ramp {
            assert_eq!(
                f64::from(style.size),
                t["ramp"][name]["size"].as_f64().unwrap(),
                "{theme:?} {name}"
            );
        }
        assert_eq!(meta.fonts.ui, t["fonts"]["ui"].as_str().unwrap());
    }
}

#[test]
fn windows_11_default_accent_is_the_measured_palette() {
    assert_eq!(
        palette(ThemeId::Fluent, Scheme::Light, "blue")
            .unwrap()
            .accent
            .hex(),
        "#0067C0"
    );
    assert_eq!(
        palette(ThemeId::Fluent, Scheme::Dark, "blue")
            .unwrap()
            .accent
            .hex(),
        "#4CC2FF"
    );
}

#[test]
fn window_settings_per_theme_and_os() {
    let fluent_win = window_settings(ThemeId::Fluent, Os::Windows);
    assert_eq!(
        fluent_win["windowEffects"]["effects"],
        serde_json::json!(["mica"])
    );
    assert_eq!(fluent_win["transparent"], true);
    let apple_mac = window_settings(ThemeId::Apple, Os::Macos);
    assert_eq!(
        apple_mac["windowEffects"]["effects"],
        serde_json::json!(["liquidGlassRegular", "underWindowBackground"])
    );
    assert_eq!(apple_mac["windowEffects"]["interactive"], true);
    assert_eq!(apple_mac["titleBarStyle"], "Overlay");
    let apple_linux = window_settings(ThemeId::Apple, Os::Other);
    assert_eq!(apple_linux["windowEffects"], serde_json::Value::Null);
    assert_eq!(apple_linux["transparent"], true);
    assert_eq!(apple_linux["cssGlassFallback"], true);
    let m3 = window_settings(ThemeId::M3, Os::Windows);
    assert_eq!(m3["transparent"], false);
}

#[test]
fn selection_file_roundtrip_and_watch() {
    use std::{sync::mpsc, time::Duration};
    let dir = std::env::temp_dir().join(format!("aphrody-themes-{}", std::process::id()));
    let path = dir.join("theme.json");
    assert_eq!(aphrody_themes::config::read(&path), Selection::default());
    let (tx, rx) = mpsc::channel();
    let _guard = aphrody_themes::config::watch(path.clone(), Duration::from_millis(20), move |s| {
        let _ = tx.send(s);
    });
    // the web runtime writes exactly this JSON
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        &path,
        r#"{"theme":"apple","scheme":"dark","accent":"pink","transparency":0.25}"#,
    )
    .unwrap();
    let got = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("watcher saw the change");
    assert_eq!(
        (got.theme.as_str(), got.accent.as_str(), got.transparency),
        ("apple", "pink", Some(0.25))
    );
    let mut next = got.clone();
    next.accent = "teal".into(); // not an apple accent: normalized back to the default
    aphrody_themes::config::write(&path, &next).unwrap();
    let again = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("watcher saw the rewrite");
    assert_eq!(again.accent, "blue");
    assert_eq!(
        Selection::from_json("{\"theme\":\"zzz\",\"accent\":5}"),
        Selection::default()
    );
    let _ = std::fs::remove_dir_all(&dir);
}
