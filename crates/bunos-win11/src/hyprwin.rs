// SPDX-License-Identifier: Apache-2.0
//! `windows-hyprland`: a Hyprland/Omarchy-style desktop on native Windows 11, assembled from pinned forks built from
//! source (docs/WINDOWS-DESKTOP.md, "Hyprland-style Windows"):
//!
//! | piece | fork | role |
//! | --- | --- | --- |
//! | GlazeWM (`vendor/glazewm`, branch `bunos` = upstream + glzr-io/glazewm#1392) | GPL-3.0 | tiling, gaps, workspaces, animations |
//! | tacky-borders (`vendor/tacky-borders`) | MIT | Hyprland gradient border with the rotating-angle animation and glow |
//! | Zebar (`vendor/zebar`) | GPL-3.0 | top bar (GlazeWM workspaces over IPC) |
//! | Flow Launcher (`vendor/flow-launcher`) | MIT | `Super+Space` launcher with an Acrylic backdrop |
//! | AltSnap (`vendor/altsnap`) | GPL-3.0 | `Super`+left-drag move, `Super`+right-drag resize |
//! | `bunos-win11-chrome watch` (ours) | Apache-2.0 | DWM backdrop, dark caption, rounded corners on every window |
//!
//! This module only renders the per-user configuration of those tools from one [`Look`] (theme roles from the
//! canonical `aphrody-m3-tokens` engine, glass level, motion). Nothing here installs, registers autostart or edits the
//! registry; `factory/windows/desktop/hyprland.ts` stages the signed binaries, starts and stops them, and undoes
//! everything by deleting the per-user tree.

use std::{collections::BTreeMap, fmt::Write as _, path::Path};

use anyhow::{Context, Result};

/// How much transparency the desktop uses. `Max` is the default; `Reduced` is chosen automatically when the user has
/// turned Transparency effects off (Settings > Personalization > Colors), the documented `EnableTransparency` value
/// that `UISettings.AdvancedEffectsEnabled` reflects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Glass {
    Max,
    Reduced,
}

impl Glass {
    pub fn parse(s: &str) -> Option<Option<Self>> {
        match s {
            "max" => Some(Some(Self::Max)),
            "reduced" => Some(Some(Self::Reduced)),
            "auto" => Some(None),
            _ => None,
        }
    }

    /// The user's Transparency effects setting (absent value = on, the Windows default).
    #[must_use]
    pub fn detect() -> Self {
        if dword(r"HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency") == Some(0) {
            Self::Reduced
        } else {
            Self::Max
        }
    }
}

/// Whether window animations run. Off when the user disabled Animation effects (Settings > Accessibility > Visual
/// effects, `HKCU\Control Panel\Desktop\WindowMetrics\MinAnimate` = "0").
#[must_use]
pub fn detect_motion() -> bool {
    string(r"HKCU:\Control Panel\Desktop\WindowMetrics", "MinAnimate").is_none_or(|v| v.trim() != "0")
}

fn reg(path: &str, name: &str) -> Option<serde_json::Value> {
    bun_windows_winclean::registry::get_value(path, name).ok()?.get("Data").cloned()
}

fn dword(path: &str, name: &str) -> Option<u64> {
    reg(path, name)?.as_u64()
}

fn string(path: &str, name: &str) -> Option<String> {
    reg(path, name)?.as_str().map(str::to_owned)
}

/// Everything the configs are rendered from.
#[derive(Debug, Clone)]
pub struct Look {
    /// Dark-scheme M3 roles (camelCase name -> `#rrggbb`), from `aphrody-m3-tokens`.
    pub roles: BTreeMap<String, String>,
    pub glass: Glass,
    pub motion: bool,
    /// Terminal for `Super+Enter`: Rio when installed (docs/WINDOWS-SHELL.md), else Windows Terminal.
    pub terminal: String,
    /// Absolute path of the staged Flow Launcher executable (`Super+Space`).
    pub launcher: String,
}

impl Look {
    /// Roles from a seed through the canonical token engine (`None` = the M3 baseline seed).
    pub fn from_seed(seed: Option<&str>) -> Result<BTreeMap<String, String>> {
        let request = aphrody_m3_tokens::theme::ThemeRequest::parse(seed, None, None).map_err(anyhow::Error::msg)?;
        Ok(request.export().dark)
    }

    /// Roles from a `bunos-design theme` export (schema 1: `{ "dark": { role: "#rrggbb" } }`), the design agent's
    /// token file.
    pub fn from_export(path: &Path) -> Result<BTreeMap<String, String>> {
        let text = std::fs::read_to_string(path).with_context(|| path.display().to_string())?;
        let doc: serde_json::Value = serde_json::from_str(&text).with_context(|| path.display().to_string())?;
        let dark = doc.get("dark").and_then(|d| d.as_object()).context("theme export has no `dark` roles")?;
        Ok(dark.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_owned()))).collect())
    }

    fn role(&self, name: &str) -> &str {
        self.roles.get(name).map_or("#888888", String::as_str)
    }
}

/// Super is the Hyprland/Omarchy modifier; GlazeWM's low-level hook captures `lwin` combos (Win+L stays the
/// system lock). Bindings follow Omarchy where Windows allows.
const MOD: &str = "lwin";

/// `config.yaml` for GlazeWM (the bunos fork's schema, including the `animations` block from #1392).
#[must_use]
pub fn glazewm(look: &Look) -> String {
    let m = look.motion;
    // Hyprland's default `myBezier` (0.05, 0.9, 0.1, 1.05): a fast start with a slight overshoot.
    let bezier = "cubic_bezier(0.05, 0.9, 0.1, 1.05)";
    let (focused, other) = match look.glass {
        Glass::Max => ("96%", "86%"),
        Glass::Reduced => ("100%", "100%"),
    };
    let glass = look.glass == Glass::Max;
    let mut y = String::new();
    let _ = write!(
        y,
        "# Generated by `bunos-win11 desktop windows-hyprland --render` (crates/bunos-win11/src/hyprwin.rs). Do not edit;
# re-render instead. Schema: vendor/glazewm (bunos branch) resources/assets/sample-config.yaml.
animations:
  window_move: {{ enabled: {m}, duration_ms: 280, easing: \"{bezier}\", threshold_px: 6 }}
  window_resize: {{ enabled: {m}, duration_ms: 280, easing: \"{bezier}\", threshold_px: 6 }}
  window_open: {{ enabled: {m}, duration_ms: 260, easing: \"{bezier}\", style: \"zoom\", opacity_from: 0.0 }}
  window_close: {{ enabled: {m}, duration_ms: 180, easing: \"ease_in_cubic\", style: \"zoom\", opacity_to: 0.0 }}
  workspace_switch:
    enabled: {m}
    duration_ms: 380
    easing: \"ease_out_cubic\"
    style: \"slide\"
    direction: \"horizontal\"
    opacity_outgoing: 1.0
    opacity_incoming: 1.0
    zoom_factor: 0.0
general:
  startup_commands: []
  shutdown_commands: []
  config_reload_commands: []
  focus_follows_cursor: true
  toggle_workspace_on_refocus: false
  cursor_jump: {{ enabled: true, trigger: \"monitor_focus\" }}
  hide_method: \"cloak\"
  show_all_in_taskbar: false
gaps:
  scale_with_dpi: true
  inner_gap: \"10px\"
  outer_gap: {{ top: \"52px\", right: \"20px\", bottom: \"20px\", left: \"20px\" }}
window_effects:
  # The Hyprland border is drawn by tacky-borders; GlazeWM leaves the DWM border alone.
  focused_window:
    border: {{ enabled: false }}
    hide_title_bar: {{ enabled: false }}
    corner_style: {{ enabled: true, style: \"rounded\" }}
    transparency: {{ enabled: {glass}, opacity: \"{focused}\" }}
  other_windows:
    border: {{ enabled: false }}
    hide_title_bar: {{ enabled: false }}
    corner_style: {{ enabled: true, style: \"rounded\" }}
    transparency: {{ enabled: {glass}, opacity: \"{other}\" }}
window_behavior:
  initial_state: \"tiling\"
  state_defaults:
    floating: {{ centered: true, shown_on_top: true }}
    fullscreen: {{ maximized: false, shown_on_top: false }}
workspaces:
"
    );
    for n in 1..=9 {
        let _ = writeln!(y, "  - name: \"{n}\"");
    }
    y.push_str(
        "window_rules:
  - commands: [\"ignore\"]
    match:
      - window_process: { equals: \"zebar\" }
      - window_process: { equals: \"tacky-borders\" }
      - window_process: { equals: \"Flow.Launcher\" }
      - window_process: { equals: \"AltSnap\" }
      - window_process: { equals: \"bunos-win11-wallpaper\" }
      - window_title: { regex: \"[Pp]icture.in.[Pp]icture\" }
        window_class: { regex: \"Chrome_WidgetWin_1|MozillaDialogClass\" }
      - window_title: { equals: \"Command Palette\" }
        window_class: { equals: \"WinUIDesktopWin32WindowClass\" }
  - commands: [\"set-floating --centered\"]
    match:
      - window_class: { equals: \"#32770\" }
      - window_process: { equals: \"SystemSettings\" }
binding_modes:
  - name: \"resize\"
    keybindings:
      - { commands: [\"resize --width -3%\"], bindings: [\"h\", \"left\"] }
      - { commands: [\"resize --width +3%\"], bindings: [\"l\", \"right\"] }
      - { commands: [\"resize --height +3%\"], bindings: [\"k\", \"up\"] }
      - { commands: [\"resize --height -3%\"], bindings: [\"j\", \"down\"] }
      - { commands: [\"wm-disable-binding-mode --name resize\"], bindings: [\"escape\", \"enter\"] }
keybindings:
",
    );
    let terminal = yaml_escape(&look.terminal);
    let launcher = yaml_escape(&look.launcher);
    let mut bind = |commands: &[&str], keys: &[&str]| {
        let c: Vec<String> = commands.iter().map(|c| format!("\"{c}\"")).collect();
        let k: Vec<String> = keys.iter().map(|k| format!("\"{}\"", k.replace("$m", MOD))).collect();
        let _ = writeln!(y, "  - {{ commands: [{}], bindings: [{}] }}", c.join(", "), k.join(", "));
    };
    bind(&[&format!("shell-exec {terminal}")], &["$m+enter"]);
    bind(&[&format!("shell-exec {launcher}")], &["$m+space"]);
    bind(&["shell-exec explorer.exe"], &["$m+shift+f"]);
    bind(&["close"], &["$m+w"]);
    bind(&["toggle-fullscreen"], &["$m+f"]);
    bind(&["toggle-floating --centered"], &["$m+t"]);
    bind(&["toggle-tiling-direction"], &["$m+j"]);
    bind(&["toggle-minimized"], &["$m+m"]);
    for (dir, key) in [("left", "left"), ("right", "right"), ("up", "up"), ("down", "down")] {
        bind(&[&format!("focus --direction {dir}")], &[&format!("$m+{key}")]);
        bind(&[&format!("move --direction {dir}")], &[&format!("$m+shift+{key}")]);
    }
    bind(&["resize --width -5%"], &["$m+oem_minus"]);
    bind(&["resize --width +5%"], &["$m+oem_plus"]);
    bind(&["resize --height -5%"], &["$m+shift+oem_minus"]);
    bind(&["resize --height +5%"], &["$m+shift+oem_plus"]);
    bind(&["wm-enable-binding-mode --name resize"], &["$m+r"]);
    bind(&["focus --next-active-workspace"], &["$m+tab"]);
    bind(&["focus --prev-active-workspace"], &["$m+shift+tab"]);
    bind(&["focus --recent-workspace"], &["$m+oem_tilde"]);
    for n in 1..=9 {
        bind(&[&format!("focus --workspace {n}")], &[&format!("$m+{n}")]);
        bind(&[&format!("move --workspace {n}"), &format!("focus --workspace {n}")], &[&format!("$m+shift+{n}")]);
    }
    bind(&["move-workspace --direction left"], &["$m+ctrl+left"]);
    bind(&["move-workspace --direction right"], &["$m+ctrl+right"]);
    bind(&["wm-toggle-pause"], &["$m+shift+p"]);
    bind(&["wm-reload-config"], &["$m+shift+r"]);
    bind(&["wm-redraw"], &["$m+shift+w"]);
    bind(&["wm-exit"], &["$m+shift+e"]);
    y
}

fn yaml_escape(s: &str) -> String {
    let quoted = if s.contains(' ') { format!("'{s}'") } else { s.to_owned() };
    quoted.replace('\\', "\\\\").replace('"', "\\\"")
}

/// `config.yaml` for tacky-borders (`TACKY_BORDERS_CONFIG_HOME`): Hyprland's two-colour 45deg gradient, its looping
/// border-angle animation, rounded to the DWM corner, with a glow at max glass.
#[must_use]
pub fn tacky_borders(look: &Look) -> String {
    let (primary, tertiary) = (look.role("primary"), look.role("tertiary"));
    let (inactive_a, inactive_b) = (look.role("outlineVariant"), look.role("surfaceContainerHighest"));
    let anim = look.motion;
    let fx = look.glass == Glass::Max;
    format!(
        "# Generated by `bunos-win11 desktop windows-hyprland --render` (crates/bunos-win11/src/hyprwin.rs).
watch_config_changes: true
enable_logging: false
enable_ipc_server: true
rendering_backend: V2
global:
  border_width: 2
  border_offset: -1
  border_radius: Auto
  border_z_order: AboveWindow
  follow_native_border: false
  initialize_delay: 150
  unminimize_delay: 120
  active_color:
    colors: [\"{primary}\", \"{tertiary}\"]
    direction: 45deg
  inactive_color:
    colors: [\"{inactive_a}\", \"{inactive_b}\"]
    direction: 45deg
  komorebi_colors:
    enabled: false
    stack_color: \"{tertiary}\"
    monocle_color: \"{primary}\"
    floating_color: \"{tertiary}\"
  animations:
    enabled: {anim}
    fps: 60
    active:
      - {{ type: ReverseSpiral, duration: 4000, easing: Linear }}
      - {{ type: Fade, duration: 180, easing: EaseInOutQuad }}
    inactive:
      - {{ type: Fade, duration: 180, easing: EaseInOutQuad }}
  effects:
    enabled: {fx}
    active:
      - {{ type: Glow, blur: 12.0, spread: 0.0, opacity: 0.55 }}
    inactive: []
window_rules:
  - {{ match: Class, name: \"Windows.UI.Core.CoreWindow\", enabled: false }}
  - {{ match: Class, name: \"XamlExplorerHostIslandWindow\", enabled: false }}
  - {{ match: Process, name: \"tacky-borders\", enabled: false }}
  - {{ match: Process, name: \"zebar\", enabled: false }}
  - {{ match: Process, name: \"Flow.Launcher\", enabled: false }}
  - {{ match: Process, name: \"AltSnap\", enabled: false }}
  - {{ match: Title, name: \"Picture-in-Picture\", enabled: false }}
"
    )
}

/// `AltSnap.ini` overrides (AltSnap falls back to its built-in defaults for every key not written): Super+left-drag
/// moves, Super+right-drag resizes, as Hyprland's `bindm = SUPER, mouse:272/273`.
#[must_use]
pub fn altsnap(look: &Look) -> String {
    let opacity = if look.glass == Glass::Max { 200 } else { 255 };
    format!(
        "; Generated by `bunos-win11 desktop windows-hyprland --render` (crates/bunos-win11/src/hyprwin.rs).
[General]
AutoFocus=0
Aero=1
SmartAero=1
InactiveScroll=1
MDI=1
ResizeAll=1
FullScreen=1
[Input]
LMB=Move
RMB=Resize
MMB=Maximize
Scroll=Nothing
; 5B 5C = left/right Windows key (Hyprland SUPER)
Hotkeys=5B 5C
[Performance]
FullWin=1
RefreshRate=0
MoveTrans={opacity}
[Advanced]
NormRestore=1
[Zones]
UseZones=0
"
    )
}

/// Flow Launcher portable `UserData/Settings/Settings.json` seed: Acrylic at max glass, no backdrop when reduced.
/// Flow merges missing keys with its defaults; the user's later changes are kept (the file is only seeded once).
#[must_use]
pub fn flow_settings(look: &Look) -> String {
    let backdrop = if look.glass == Glass::Max { 1 } else { 0 }; // BackdropTypes: None=0, Acrylic=1
    let doc = serde_json::json!({
        "Hotkey": "Alt + Space",
        "Theme": "Darker Glass",
        "BackdropType": backdrop,
        "UseDropShadowEffect": true,
        "UseAnimation": look.motion,
        "HideOnStartup": true,
        "StartFlowLauncherOnSystemStartup": false,
        "AutoUpdates": false,
    });
    let mut out = serde_json::to_string_pretty(&doc).expect("settings serialise");
    out.push('\n');
    out
}

/// Zebar theme: overrides of the starter bar's CSS variables (vendor/zebar/resources/starter/styles.css) from the M3
/// roles, a translucent surface at max glass and an opaque one when reduced. The launcher appends it to the bar's
/// stylesheet so the bar follows the same tokens as the borders.
#[must_use]
pub fn zebar_css(look: &Look) -> String {
    let surface = look.role("surfaceContainer").trim_start_matches('#');
    let (r, g, b) = (
        u8::from_str_radix(&surface[0..2], 16).unwrap_or(0),
        u8::from_str_radix(&surface[2..4], 16).unwrap_or(0),
        u8::from_str_radix(&surface[4..6], 16).unwrap_or(0),
    );
    let alpha = if look.glass == Glass::Max { 62 } else { 100 };
    format!(
        "/* Generated by `bunos-win11 desktop windows-hyprland --render` (crates/bunos-win11/src/hyprwin.rs). */
:root {{
  --text-color-dark: {on};
  --text-color-light: {on};
  --icon-color-dark: {primary};
  --icon-color-light: {primary};
  --background-color-dark: rgb({r} {g} {b} / {alpha}%);
  --background-color-light: rgb({r} {g} {b} / {alpha}%);
}}
#root {{ border-radius: 12px; margin: 6px 20px 0; border: 1px solid {outline}; backdrop-filter: blur(24px); }}
",
        on = look.role("onSurface"),
        primary = look.role("primary"),
        outline = look.role("outlineVariant"),
    )
}

/// Render every config under `dir`, returning the written paths.
pub fn render(look: &Look, dir: &Path) -> Result<Vec<std::path::PathBuf>> {
    let files = [
        ("glazewm/config.yaml", glazewm(look)),
        ("tacky-borders/config.yaml", tacky_borders(look)),
        ("altsnap/AltSnap.ini", altsnap(look)),
        ("flow-launcher/UserData/Settings/Settings.json", flow_settings(look)),
        ("zebar/bunos-theme.css", zebar_css(look)),
    ];
    let mut written = Vec::new();
    for (rel, body) in files {
        let path = dir.join(rel);
        if rel.starts_with("flow-launcher/") && path.exists() {
            continue; // seeded once; Flow owns it afterwards
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| parent.display().to_string())?;
        }
        std::fs::write(&path, body).with_context(|| path.display().to_string())?;
        written.push(path);
    }
    Ok(written)
}

/// The first `name` found on `PATH`.
#[must_use]
pub fn on_path(name: &str) -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(name)).find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn look(glass: Glass, motion: bool) -> Look {
        Look {
            roles: Look::from_seed(None).unwrap(),
            glass,
            motion,
            terminal: "wt".into(),
            launcher: r"C:\Users\me\AppData\Local\bunos\desktop\flow-launcher\Flow.Launcher.exe".into(),
        }
    }

    #[test]
    fn glazewm_has_hyprland_bindings_gaps_and_animations() {
        let y = glazewm(&look(Glass::Max, true));
        assert!(y.contains("bindings: [\"lwin+enter\"]") && y.contains("bindings: [\"lwin+space\"]"));
        assert!(y.contains("\"move --workspace 9\", \"focus --workspace 9\""));
        assert!(y.contains("inner_gap: \"10px\"") && y.contains("cubic_bezier(0.05, 0.9, 0.1, 1.05)"));
        assert!(y.contains("window_open: { enabled: true"));
        assert!(y.contains("transparency: { enabled: true, opacity: \"86%\" }"));
        assert!(y.contains(r"C:\\Users\\me"), "windows paths are YAML-escaped");
    }

    #[test]
    fn reduced_glass_and_motion_fall_back() {
        let y = glazewm(&look(Glass::Reduced, false));
        assert!(y.contains("transparency: { enabled: false, opacity: \"100%\" }"));
        assert!(y.contains("window_move: { enabled: false"));
        let t = tacky_borders(&look(Glass::Reduced, false));
        assert!(t.contains("effects:\n    enabled: false") && t.contains("animations:\n    enabled: false"));
        assert!(flow_settings(&look(Glass::Reduced, true)).contains("\"BackdropType\": 0"));
    }

    #[test]
    fn borders_use_the_m3_roles() {
        let l = look(Glass::Max, true);
        let t = tacky_borders(&l);
        assert!(t.contains(&format!("colors: [\"{}\", \"{}\"]", l.role("primary"), l.role("tertiary"))));
        assert!(l.role("primary").starts_with('#') && l.role("primary").len() == 7);
    }

    #[test]
    fn altsnap_uses_the_super_key() {
        let a = altsnap(&look(Glass::Max, true));
        assert!(a.contains("Hotkeys=5B 5C") && a.contains("LMB=Move") && a.contains("RMB=Resize"));
    }
}
