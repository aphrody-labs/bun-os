//! Material 3 dynamic colour computed by the canonical Rust token engine (crates/aphrody-m3-tokens), the same engine
//! behind the web `--md-sys-color-*` sheets, the COSMIC theme and the generated Compose/Flutter themes.

use aphrody_m3_tokens::theme::ThemeRequest;

/// One colour role of a scheme.
pub struct RoleColor {
    /// camelCase role name, as in Flutter's `ColorScheme` (`onPrimaryContainer`).
    pub name: String,
    /// Opaque ARGB.
    pub argb: u32,
}

/// Every M3 role for `seed` (`#rrggbb`), `variant` (`tonalSpot`, `vibrant`, `expressive`, ...), mode and contrast (-1..1).
///
/// # Errors
/// Invalid seed, unknown variant or contrast outside -1..=1.
#[flutter_rust_bridge::frb(sync)]
pub fn scheme_from_seed(seed: String, variant: String, dark: bool, contrast: f64) -> Result<Vec<RoleColor>, String> {
    let request = ThemeRequest::parse(Some(&seed), Some(&variant), Some(contrast))?;
    Ok(request
        .scheme(dark)
        .roles()
        .map(|(role, argb)| RoleColor {
            name: role.camel_name().to_owned(),
            argb,
        })
        .collect())
}

/// WCAG contrast ratio between two roles of the scheme, measured on the emitted sRGB colours.
///
/// # Errors
/// Invalid request or unknown role name.
#[flutter_rust_bridge::frb(sync)]
pub fn role_contrast(seed: String, variant: String, dark: bool, foreground: String, background: String) -> Result<f64, String> {
    use aphrody_m3_tokens::scheme::Role;
    let request = ThemeRequest::parse(Some(&seed), Some(&variant), Some(0.0))?;
    let fg = Role::from_name(&foreground).ok_or_else(|| format!("unknown role {foreground}"))?;
    let bg = Role::from_name(&background).ok_or_else(|| format!("unknown role {background}"))?;
    Ok(request.contrast(dark, fg, bg))
}

/// Version of the Rust core linked into the app.
#[flutter_rust_bridge::frb(sync)]
pub fn core_version() -> String {
    format!("bunos-flutter-bridge {} / aphrody-m3-tokens spec {}", env!("CARGO_PKG_VERSION"), aphrody_m3_tokens::theme::SPEC_VERSION)
}

#[flutter_rust_bridge::frb(init)]
pub fn init_app() {
    flutter_rust_bridge::setup_default_user_utils();
}
