// SPDX-License-Identifier: Apache-2.0
//! Terminal themes: stable values, measured contrast, valid JSON/TOML, versioned copies current.

use aphrody_identity::terminal_theme::{
    ANSI_NAMES, CONFIG_DIR, FILES, HUES, NUSHELL, RIO_THEME_DARK, RIO_THEME_LIGHT, TerminalTheme,
    WT_SCHEME_DARK, WT_SCHEME_LIGHT, hue_degrees, xterm256,
};
use aphrody_m3_tokens::{color_math::hex_from_argb, scheme::Role};
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn snapshot(theme: &TerminalTheme) -> String {
    theme
        .modes()
        .iter()
        .map(|m| {
            let ansi: Vec<String> = m.ansi.iter().map(|c| hex_from_argb(*c)).collect();
            format!(
                "{} bg {} fg {} cursor {} selection {} ansi {}",
                m.wt_name(),
                hex_from_argb(m.background()),
                hex_from_argb(m.foreground()),
                hex_from_argb(m.cursor()),
                hex_from_argb(m.selection_background()),
                ansi.join(" ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn values_are_stable() {
    assert_eq!(
        snapshot(&TerminalTheme::aphrody()),
        "Aphrody M3 bg #171216 fg #ebdfe6 cursor #efb4e9 selection #643663 ansi \
         #3a3338 #ffb4ab #a0d756 #ffb95b #b0c6ff #efb4e9 #63d3ff #d1c3cc \
         #9a8d96 #ffdad6 #bbf46f #ffddb6 #d9e2ff #ffd6f8 #bce9ff #ebdfe6\n\
         Aphrody M3 Light bg #fff7fa fg #201a1e cursor #7e4d7c selection #ffd6f8 ansi \
         #201a1e #ba1a1a #426900 #845400 #1a59c2 #7e4d7c #006783 #ebdfe6 \
         #4e444b #93000a #304f00 #643f00 #00419c #643663 #004d63 #ffffff"
    );
}

#[test]
fn ansi_follows_the_m3_roles() {
    let theme = TerminalTheme::aphrody();
    for m in theme.modes() {
        assert_eq!(m.ansi[1], m.role(Role::Error), "red is the error role");
        assert_eq!(
            m.ansi[5],
            m.role(Role::Primary),
            "magenta is the primary role"
        );
        assert_eq!(m.background(), m.role(Role::Surface));
        assert_eq!(m.foreground(), m.role(Role::OnSurface));
    }
    assert_eq!(theme.dark.ansi[8], theme.dark.role(Role::Outline));
    assert_eq!(theme.light.ansi[0], theme.light.role(Role::OnSurface));
}

#[test]
fn harmonized_hues_stay_distinct() {
    let theme = TerminalTheme::aphrody();
    let hues = hue_degrees(theme.request);
    for (i, a) in hues.iter().enumerate() {
        for (j, b) in hues.iter().enumerate().skip(i + 1) {
            let d = (a - b).rem_euclid(360.0);
            let d = d.min(360.0 - d);
            assert!(
                d >= 30.0,
                "{} and {} only {d:.1}° apart",
                HUES[i].0,
                HUES[j].0
            );
        }
    }
}

#[test]
fn every_drawn_pair_meets_its_contrast_minimum() {
    let checks = TerminalTheme::aphrody().contrast_checks();
    let failing: Vec<String> = checks
        .iter()
        .filter(|c| !c.ok())
        .map(|c| format!("{} {} {:.2} < {}", c.mode, c.what, c.ratio, c.minimum))
        .collect();
    assert!(failing.is_empty(), "{failing:#?}");
    // 2 modes × (4 chrome + 15 ANSI text slots minus the background slots + Nushell fg + prompt + Rio).
    assert!(checks.len() > 150, "only {} pairs measured", checks.len());
    assert!(
        checks
            .iter()
            .any(|c| c.mode == "light" && c.what == "ansi.bright-black")
    );
}

#[test]
fn windows_terminal_json_is_valid() {
    let theme = TerminalTheme::aphrody();
    let v: serde_json::Value = serde_json::from_str(&theme.windows_terminal_json()).unwrap();
    let schemes = v.as_array().unwrap();
    assert_eq!(schemes.len(), 2);
    assert_eq!(schemes[0]["name"], WT_SCHEME_DARK);
    assert_eq!(schemes[1]["name"], WT_SCHEME_LIGHT);
    for s in schemes {
        // name, background, foreground, cursorColor, selectionBackground + 16 ANSI.
        assert_eq!(s.as_object().unwrap().len(), 21);
        assert!(s["brightPurple"].as_str().unwrap().starts_with('#'));
    }
    let prompt: serde_json::Value = serde_json::from_str(&theme.prompt_json()).unwrap();
    assert_eq!(
        prompt["dark"]["brand"]["hex"],
        hex_from_argb(theme.dark.cursor())
    );
    assert!(prompt["light"]["cwd"]["ansi256"].as_u64().unwrap() <= 255);
}

#[test]
fn rio_toml_is_valid() {
    let theme = TerminalTheme::aphrody();
    for dark in [true, false] {
        let text = theme.rio_toml(dark);
        let v: toml::Table = toml::from_str(&text).unwrap();
        let colors = v["colors"].as_table().unwrap();
        for name in ANSI_NAMES {
            let key = name.replace("bright-", "light-");
            assert!(colors[&key].as_str().unwrap().starts_with('#'), "{key}");
        }
        assert!(colors.contains_key("selection-background"));
        assert_eq!(colors.len(), 16 + 16);
    }
}

#[test]
fn nushell_covers_the_default_keys_once() {
    let mut keys: Vec<&str> = NUSHELL.iter().map(|(k, _)| *k).collect();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(keys.len(), NUSHELL.len(), "duplicate color_config key");
    let nu = TerminalTheme::aphrody().nushell();
    assert!(nu.contains("export const dark = {") && nu.contains("export const light = {"));
    assert!(nu.contains("\"semver-range\": "));
    assert!(nu.contains("$env.config.color_config = "));
}

#[test]
fn settings_splice_replaces_only_the_schemes() {
    let theme = TerminalTheme::aphrody();
    let before = "{\n  \"a\": [1],\n  \"schemes\": [\n    { \"name\": \"Old\", \"x\": \"]\" }\n  ],\n  \"z\": true\n}\n";
    let after = theme.splice_wt_settings(before).unwrap();
    let v: serde_json::Value = serde_json::from_str(&after).unwrap();
    assert_eq!(v["schemes"][0]["name"], WT_SCHEME_DARK);
    assert_eq!(v["schemes"].as_array().unwrap().len(), 2);
    assert!(after.starts_with("{\n  \"a\": [1],\n  \"schemes\": [\n    {\n      \"name\""));
    assert!(after.ends_with("\n  ],\n  \"z\": true\n}\n"));
    assert_eq!(
        theme.splice_wt_settings(&after).unwrap(),
        after,
        "idempotent"
    );
}

#[test]
fn xterm256_picks_cube_and_grey() {
    assert_eq!(xterm256(0xFF00_0000), 16);
    assert_eq!(xterm256(0xFFFF_FFFF), 231);
    assert_eq!(xterm256(0xFF80_8080), 244);
    assert_eq!(xterm256(0xFFFF_0000), 196);
}

/// Gate: the versioned files are exactly what the generator writes.
#[test]
fn versioned_files_are_current() {
    let theme = TerminalTheme::aphrody();
    let dir = repo_root().join(CONFIG_DIR);
    for (rel, text) in theme.files() {
        let path = dir.join(rel);
        let on_disk = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .replace("\r\n", "\n");
        assert!(
            on_disk == text,
            "{rel} differs: run `aphrody identity terminal-theme`"
        );
    }
    assert_eq!(FILES.len(), theme.files().len());
    assert!(FILES.contains(&format!("rio/themes/{RIO_THEME_DARK}.toml").as_str()));
    assert!(FILES.contains(&format!("rio/themes/{RIO_THEME_LIGHT}.toml").as_str()));

    let settings_path = dir.join("settings.json");
    let settings = std::fs::read_to_string(&settings_path)
        .unwrap()
        .replace("\r\n", "\n");
    assert_eq!(
        theme.splice_wt_settings(&settings).unwrap(),
        settings,
        "settings.json schemes"
    );
    let v: serde_json::Value = serde_json::from_str(&settings).unwrap();
    let scheme = &v["profiles"]["defaults"]["colorScheme"];
    assert_eq!(scheme["dark"], WT_SCHEME_DARK);
    assert_eq!(scheme["light"], WT_SCHEME_LIGHT);
}
