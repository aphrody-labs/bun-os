// SPDX-License-Identifier: Apache-2.0
//! The generated CSS sheets of the M3 layer, rendered from this crate's tokens.
//!
//! | Sheet | Function | Published as |
//! | --- | --- | --- |
//! | Fusion palette: M3 roles + shadcn/ui aliases + Tailwind aliases, light and dark | [`tokens_css`] | `@aphrody/m3-theme/tokens.css` |
//! | Every M3 token as a Tailwind v4 utility, baseline extended roles | [`tailwind_css`] | `@aphrody/m3-theme/tailwind.css` |
//! | The SpaceUI themes as M3 schemes, SpaceUI aliases | [`spaceui_css`] | `@aphrody/m3-theme/spaceui.css` |
//! | One scheme's roles and extended roles | [`scheme_css`] | `m3:theme.css` (`@aphrody/m3` plugin) |
//! | Shape, typescale, motion, elevation, state (no colour) | [`static_css`] | `@aphrody/m3-tokens/m3-tokens.css` |
//!
//! `tests/sheets_golden.rs` checks (or, with `APHRODY_UPDATE_TOKENS=1`, rewrites) the two committed
//! files `m3/packages/m3-theme/tokens.css` and `m3/packages/m3-tokens/src/m3-tokens.css`.
//!
//! Colours come from [`crate::scheme`], an exact port of material-color-utilities, so the sheets
//! match Material Theme Builder. `@aphrody/bun` exposes [`render`] through `m3Css()`.

use crate::{
    adaptive::Breakpoint,
    blend::custom_color,
    color::FUSION_ALIAS_MAP,
    color_math::hex_from_argb,
    elevation,
    hct::Hct,
    motion,
    palette::TonalPalette,
    scheme::{DynamicScheme, Palettes, Role, Variant},
    shape,
    spaceui::{self, Theme},
    state, typography,
};

/// Default scheme source: the M3 baseline seed `#6750A4`.
pub const BASELINE_SEED: u32 = 0xFF67_50A4;

/// A sheet to render, with the scheme parameters the palette sheets use.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SheetRequest {
    /// Which sheet.
    pub sheet: Sheet,
    /// Scheme source colour.
    pub seed: u32,
    /// Scheme variant.
    pub variant: Variant,
    /// Contrast level (-1..=1).
    pub contrast: f64,
    /// Dark mode (only [`Sheet::Scheme`] renders a single mode).
    pub dark: bool,
}

impl Default for SheetRequest {
    fn default() -> Self {
        Self {
            sheet: Sheet::Tokens,
            seed: BASELINE_SEED,
            variant: Variant::TonalSpot,
            contrast: 0.0,
            dark: false,
        }
    }
}

impl SheetRequest {
    /// A request from its textual parts (FFI, WASM, Tauri and CLI callers).
    ///
    /// # Errors
    /// Unknown sheet or variant, a seed that is not `#rgb`/`#rrggbb`, a contrast outside -1..=1.
    pub fn parse(
        sheet: &str,
        seed: Option<&str>,
        variant: Option<&str>,
        dark: Option<bool>,
        contrast: Option<f64>,
    ) -> Result<Self, String> {
        let mut out = Self {
            sheet: Sheet::from_name(sheet).ok_or_else(|| format!("unknown sheet {sheet:?}"))?,
            ..Self::default()
        };
        if let Some(seed) = seed {
            out.seed = crate::color_math::argb_from_hex(seed)
                .ok_or_else(|| format!("invalid seed {seed:?}"))?;
        }
        if let Some(variant) = variant {
            out.variant = Variant::from_name(variant)
                .ok_or_else(|| format!("unknown variant {variant:?}"))?;
        }
        if let Some(contrast) = contrast {
            if !(-1.0..=1.0).contains(&contrast) {
                return Err(format!("contrast {contrast} outside -1..=1"));
            }
            out.contrast = contrast;
        }
        out.dark = dark.unwrap_or(false);
        Ok(out)
    }
}

/// The sheets [`render`] knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sheet {
    /// [`tokens_css`].
    Tokens,
    /// [`tailwind_css`].
    Tailwind,
    /// [`spaceui_css`].
    Spaceui,
    /// [`scheme_css`].
    Scheme,
    /// [`static_css`].
    Static,
    /// Gemini / Aphrody brand tokens CSS ([`crate::gemini_brand::export_aphrody_brand_css`]).
    Brand,
    /// Google-qualified component tokens ([`crate::component::export_css`]).
    Components,
}

impl Sheet {
    /// Parse `tokens`, `tailwind`, `spaceui`, `scheme`, `static`, `brand` or `components`.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "tokens" => Self::Tokens,
            "tailwind" => Self::Tailwind,
            "spaceui" => Self::Spaceui,
            "scheme" => Self::Scheme,
            "static" | "m3-tokens" => Self::Static,
            "brand" | "gemini" | "aphrody" => Self::Brand,
            "components" | "comp" => Self::Components,
            _ => return None,
        })
    }
}

/// Render the requested sheet.
#[must_use]
pub fn render(request: &SheetRequest) -> String {
    match request.sheet {
        Sheet::Tokens => tokens_css(request.seed, request.variant, request.contrast),
        Sheet::Tailwind => tailwind_css(),
        Sheet::Spaceui => spaceui_css(),
        Sheet::Scheme => scheme_css(
            request.seed,
            request.variant,
            request.dark,
            request.contrast,
        ),
        Sheet::Static => static_css(),
        Sheet::Brand => crate::gemini_brand::export_aphrody_brand_css(),
        Sheet::Components => crate::component::export_css(),
    }
}

/// M3 extended roles: name and seed, harmonised toward each scheme source.
pub const EXTENDED: &[(&str, u32)] = spaceui::EXTENDED;

fn header(what: &str, regenerate: &str) -> String {
    format!(
        "/* SPDX-License-Identifier: Apache-2.0 */\n/*\n * {what}\n * GENERATED - do not \
         hand-edit. Source: crates/aphrody-m3-tokens/src/sheets.rs.\n * Regenerate with: \
         {regenerate}\n */\n"
    )
}

fn role_vars(scheme: &DynamicScheme) -> Vec<(String, String)> {
    scheme
        .roles()
        .map(|(role, argb)| {
            (
                format!("--md-sys-color-{}", role.name()),
                hex_from_argb(argb),
            )
        })
        .collect()
}

fn extended_vars(source: u32, dark: bool) -> Vec<(String, String)> {
    EXTENDED
        .iter()
        .flat_map(|(name, seed)| {
            let group = custom_color(source, *seed, true);
            let tones = if dark { group.dark } else { group.light };
            [
                (format!("--md-ext-color-{name}"), tones.color),
                (format!("--md-ext-color-on-{name}"), tones.on_color),
                (
                    format!("--md-ext-color-{name}-container"),
                    tones.color_container,
                ),
                (
                    format!("--md-ext-color-on-{name}-container"),
                    tones.on_color_container,
                ),
            ]
        })
        .map(|(key, argb)| (key, hex_from_argb(argb)))
        .collect()
}

fn block(selectors: &[&str], vars: &[(String, String)], extra: &str) -> String {
    let body: Vec<String> = vars
        .iter()
        .map(|(key, value)| format!("  {key}: {value};"))
        .collect();
    format!(
        "{} {{\n{extra}{}\n}}",
        selectors.join(",\n"),
        body.join("\n")
    )
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|line| format!("  {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// One scheme's 49 roles plus its extended roles in a `:root` block.
#[must_use]
pub fn scheme_css(seed: u32, variant: Variant, dark: bool, contrast: f64) -> String {
    let scheme = DynamicScheme::from_argb(seed, variant, dark, contrast);
    let mut vars = role_vars(&scheme);
    vars.extend(extended_vars(seed, dark));
    let mode = if dark { "dark" } else { "light" };
    format!(
        "{}\n{}\n",
        header(
            &format!(
                "M3 {} scheme, {mode}, seed {}.",
                variant.name(),
                hex_from_argb(seed)
            ),
            "m3 tokens"
        ),
        block(&[":root"], &vars, &format!("  color-scheme: {mode};\n"))
    )
}

/// The fusion palette sheet (`tokens.css`): every M3 role for light and dark, the shadcn/ui
/// aliases and their Tailwind v4 `@theme inline` twins.
#[must_use]
pub fn tokens_css(seed: u32, variant: Variant, contrast: f64) -> String {
    let light = role_vars(&DynamicScheme::from_argb(seed, variant, false, contrast));
    let dark = role_vars(&DynamicScheme::from_argb(seed, variant, true, contrast));
    let shadcn: Vec<(String, String)> = FUSION_ALIAS_MAP
        .iter()
        .map(|(alias, role)| (format!("--{alias}"), format!("var(--md-sys-color-{role})")))
        .collect();
    let tailwind: Vec<(String, String)> = FUSION_ALIAS_MAP
        .iter()
        .map(|(alias, role)| {
            (
                format!("--color-{alias}"),
                format!("var(--md-sys-color-{role})"),
            )
        })
        .collect();
    format!(
        "{header}\n{light}\n\n{shadcn}\n\n{tailwind}\n\n/* Dark palette. The shadcn + Tailwind \
         aliases above reference these vars, so\n   only the M3 palette is re-declared. Automatic \
         via prefers-color-scheme;\n   force it with class=\"dark\" on a root element. */\n@media \
         (prefers-color-scheme: dark) {{\n{media}\n}}\n\n{dark}\n",
        header = header(
            &format!(
                "Canonical Material 3 fusion tokens (M3 + shadcn/ui + Tailwind v4), light + \
                 dark.\n * Scheme: {} from seed {}.",
                variant.name(),
                hex_from_argb(seed)
            ),
            "bun run generate",
        ),
        light = block(&[":root"], &light, ""),
        shadcn = block(&[":root"], &shadcn, ""),
        tailwind = block(&["@theme inline"], &tailwind, ""),
        media = indent(&block(&[":root:not(.light)"], &dark, "")),
        dark = block(&[":root.dark", ".dark"], &dark, ""),
    )
}

/// Roles that a palette sheet may omit, with the core role Tailwind falls back to.
const ROLE_FALLBACKS: &[(Role, Role)] = &[
    (Role::SurfaceTint, Role::Primary),
    (Role::PrimaryFixed, Role::PrimaryContainer),
    (Role::PrimaryFixedDim, Role::Primary),
    (Role::OnPrimaryFixed, Role::OnPrimaryContainer),
    (Role::OnPrimaryFixedVariant, Role::OnPrimaryContainer),
    (Role::SecondaryFixed, Role::SecondaryContainer),
    (Role::SecondaryFixedDim, Role::Secondary),
    (Role::OnSecondaryFixed, Role::OnSecondaryContainer),
    (Role::OnSecondaryFixedVariant, Role::OnSecondaryContainer),
    (Role::TertiaryFixed, Role::TertiaryContainer),
    (Role::TertiaryFixedDim, Role::Tertiary),
    (Role::OnTertiaryFixed, Role::OnTertiaryContainer),
    (Role::OnTertiaryFixedVariant, Role::OnTertiaryContainer),
];

const EASINGS: [motion::Easing; 7] = [
    motion::EASING_LINEAR,
    motion::EASING_STANDARD,
    motion::EASING_STANDARD_DECELERATE,
    motion::EASING_STANDARD_ACCELERATE,
    motion::EASING_EMPHASIZED,
    motion::EASING_EMPHASIZED_DECELERATE,
    motion::EASING_EMPHASIZED_ACCELERATE,
];

fn extended_role_names(name: &str) -> [String; 4] {
    [
        name.to_owned(),
        format!("on-{name}"),
        format!("{name}-container"),
        format!("on-{name}-container"),
    ]
}

/// Every M3 system token as a Tailwind v4 utility (`tailwind.css`), plus the baseline extended
/// roles at zero specificity.
#[must_use]
pub fn tailwind_css() -> String {
    let mut lines: Vec<String> = Role::ALL
        .iter()
        .map(|role| {
            let name = role.name();
            match ROLE_FALLBACKS.iter().find(|(r, _)| r == role) {
                Some((_, fallback)) => {
                    format!(
                        "  --color-{name}: var(--md-sys-color-{name}, var(--md-sys-color-{}));",
                        fallback.name()
                    )
                }
                None => format!("  --color-{name}: var(--md-sys-color-{name});"),
            }
        })
        .collect();
    for (name, _) in EXTENDED {
        lines.extend(
            extended_role_names(name)
                .iter()
                .map(|r| format!("  --color-{r}: var(--md-ext-color-{r});")),
        );
    }
    lines.push(String::new());
    lines.extend(
        shape::NAMES
            .iter()
            .map(|s| format!("  --radius-{s}: var(--md-sys-shape-corner-{s});")),
    );
    lines.push(String::new());
    for t in typography::NAMES {
        lines.push(format!("  --text-{t}: var(--md-sys-typescale-{t}-size);"));
        lines.push(format!(
            "  --text-{t}--line-height: var(--md-sys-typescale-{t}-line-height);"
        ));
        lines.push(format!(
            "  --text-{t}--letter-spacing: var(--md-sys-typescale-{t}-tracking);"
        ));
        lines.push(format!(
            "  --text-{t}--font-weight: var(--md-sys-typescale-{t}-weight);"
        ));
    }
    lines.push(String::new());
    lines.extend(
        [
            "  --font-brand: var(--md-ref-typeface-brand);",
            "  --font-plain: var(--md-ref-typeface-plain);",
            "  --font-code: var(--md-ref-typeface-code);",
            "  --font-sans: var(--md-ref-typeface-plain);",
            "  --font-mono: var(--md-ref-typeface-code);",
        ]
        .map(String::from),
    );
    lines.push(String::new());
    lines.extend((1..=5).map(|l| format!("  --shadow-md3-{l}: var(--md-sys-elevation-level{l});")));
    lines.push(String::new());
    lines.extend(
        EASINGS
            .iter()
            .map(|e| format!("  --ease-{0}: var(--md-sys-motion-easing-{0});", e.name)),
    );
    lines.push(String::new());
    lines.extend(
        Breakpoint::ALL
            .iter()
            .filter(|bp| bp.min_width_dp() > 0)
            .map(|bp| {
                format!(
                    "  --breakpoint-{}: {}rem;",
                    bp.token(),
                    f64::from(bp.min_width_dp()) / 16.0
                )
            }),
    );

    let light = block(&[":where(:root)"], &extended_vars(BASELINE_SEED, false), "");
    let dark = extended_vars(BASELINE_SEED, true);
    format!(
        "{header}\n/*\n * Import after `tailwindcss`, `@aphrody/m3-tokens/m3-tokens.css` \
         (shape,\n * typescale, elevation, motion, state) and a palette sheet\n * \
         (`@aphrody/m3-theme/tokens.css` or `@aphrody/m3-theme/spaceui.css`).\n * State layers \
         are opacity modifiers on the content role, as in M3:\n * `hover:bg-on-surface/8`, \
         `active:bg-on-surface/10`, `hover:bg-on-primary/8`.\n */\n\n@theme inline \
         {{\n{body}\n}}\n\n/* Baseline extended roles (seed #6750A4). Zero specificity: any \
         palette sheet\n   that declares them (spaceui.css does, per theme) wins regardless of \
         order. */\n{light}\n\n@media (prefers-color-scheme: dark) \
         {{\n{media}\n}}\n\n{dark_block}\n",
        header = header(
            "Material 3 → Tailwind v4 utilities, plus baseline M3 extended roles.",
            "bun run generate:fusion"
        ),
        body = lines.join("\n"),
        media = indent(&block(&[":where(:root)"], &dark, "")),
        dark_block = block(&[":where(:root.dark, .dark)"], &dark, ""),
    )
}

/// `--md-ref-typeface-brand` / `-plain` stack.
const TYPEFACE_SANS: &str = "\"Google Sans Flex\", \"Google Sans\", Roboto, system-ui, sans-serif";
/// `--md-ref-typeface-code` stack.
const TYPEFACE_CODE: &str = "\"Google Sans Code\", \"JetBrains Mono\", ui-monospace, monospace";

/// Number of leading type styles (display, headline, title-large) set in the brand typeface.
const BRAND_TYPE_STYLES: usize = 7;

const LEGACY_EASINGS: [motion::Easing; 3] = [
    motion::EASING_LEGACY,
    motion::EASING_LEGACY_ACCELERATE,
    motion::EASING_LEGACY_DECELERATE,
];

/// A length in rem from dp (base 16 px), printed without float noise (`4`, `0.009375`).
fn rem(dp: f32) -> String {
    format!("{}rem", dp / 16.0)
}

/// The non-colour M3 token families as runtime custom properties (`m3-tokens.css`): shape,
/// typescale, motion (durations, easings, springs of the web-default scheme), elevation and state.
///
/// Spring tokens use [`motion::MotionScheme::WEB_DEFAULT`] (material-web v2.5.0 equals the Compose
/// Standard scheme). Elevation shadows keep a black fallback for engines without relative colour
/// syntax, then re-declare from `--md-sys-elevation-shadow-color` under `@supports`.
#[must_use]
pub fn static_css() -> String {
    let mut root: Vec<String> = vec!["  /* Shape: corner scale. */".into()];
    root.extend(
        shape::NAMES
            .iter()
            .zip(shape::ALL)
            .map(|(name, c)| format!("  --md-sys-shape-corner-{name}: {}px;", c.dp)),
    );
    root.push(String::new());
    root.push("  /* Typescale: tracking. */".into());
    root.extend(
        typography::NAMES
            .iter()
            .zip(typography::ALL)
            .map(|(name, t)| {
                format!(
                    "  --md-sys-typescale-{name}-tracking: {};",
                    rem(t.letter_spacing_dp)
                )
            }),
    );
    root.push(String::new());
    root.push("  /* Typescale: typefaces, weight, size, line height. */".into());
    root.push(format!("  --md-ref-typeface-brand: {TYPEFACE_SANS};"));
    root.push(format!("  --md-ref-typeface-plain: {TYPEFACE_SANS};"));
    root.push(format!("  --md-ref-typeface-code: {TYPEFACE_CODE};"));
    root.push(String::new());
    for (i, (name, t)) in typography::NAMES.iter().zip(typography::ALL).enumerate() {
        let face = if i < BRAND_TYPE_STYLES {
            "brand"
        } else {
            "plain"
        };
        root.push(format!(
            "  --md-sys-typescale-{name}-font: var(--md-ref-typeface-{face});"
        ));
        root.push(format!("  --md-sys-typescale-{name}-weight: {};", t.weight));
        root.push(format!(
            "  --md-sys-typescale-{name}-size: {};",
            rem(t.size_dp)
        ));
        root.push(format!(
            "  --md-sys-typescale-{name}-line-height: {};",
            rem(t.line_height_dp)
        ));
    }
    root.push(String::new());
    root.push("  /* Motion: durations. */".into());
    root.extend(
        motion::ALL_DURATIONS
            .iter()
            .map(|d| format!("  --md-sys-motion-duration-{}: {}ms;", d.name, d.ms)),
    );
    root.push(String::new());
    root.push("  /* Motion: easings. */".into());
    root.extend(
        EASINGS
            .iter()
            .chain(&LEGACY_EASINGS)
            .map(|e| format!("  --md-sys-motion-easing-{}: {};", e.name, e.cubic_bezier)),
    );
    root.push(String::new());
    root.push("  /* Motion: springs (web default scheme, damping ratio and stiffness). */".into());
    for family in [motion::SpringFamily::Spatial, motion::SpringFamily::Effects] {
        for (speed, speed_name) in [
            (motion::SpringSpeed::Fast, "fast"),
            (motion::SpringSpeed::Default, "default"),
            (motion::SpringSpeed::Slow, "slow"),
        ] {
            let spring = motion::M3Spring::token(motion::MotionScheme::WEB_DEFAULT, speed, family);
            let family_name = if family == motion::SpringFamily::Spatial {
                "spatial"
            } else {
                "effects"
            };
            root.push(format!(
                "  --md-sys-motion-spring-{speed_name}-{family_name}-damping: {};",
                spring.damping
            ));
            root.push(format!(
                "  --md-sys-motion-spring-{speed_name}-{family_name}-stiffness: {};",
                spring.stiffness
            ));
        }
    }
    root.push(String::new());
    root.push("  /* Elevation: shadow colour and levels 0 to 5 (black fallback). */".into());
    root.push("  --md-sys-elevation-shadow-color: var(--md-sys-color-shadow, #000);".into());
    root.push(String::new());
    root.push("  --md-sys-elevation-level0: none;".into());
    let shadow = |level: usize, color: &dyn Fn(f32) -> String| {
        let [key, ambient] = elevation::SHADOWS[level - 1];
        format!(
            "    {},\n    {}",
            key.css(&color(elevation::KEY_ALPHA)),
            ambient.css(&color(elevation::AMBIENT_ALPHA))
        )
    };
    for level in 1..=5 {
        root.push(format!(
            "  --md-sys-elevation-level{level}:\n{};",
            shadow(level, &|a| format!("rgb(0 0 0 / {a})"))
        ));
    }
    let relative: Vec<String> = (1..=5)
        .map(|level| {
            let body = shadow(level, &|a| {
                format!("rgb(from var(--md-sys-elevation-shadow-color) r g b / {a})")
            });
            format!("  --md-sys-elevation-level{level}:\n{body};")
        })
        .collect();
    let state: Vec<String> = state::NAMES
        .iter()
        .zip(state::ALL)
        .take(4)
        .map(|(name, layer)| {
            format!(
                "  --md-sys-state-{name}-state-layer-opacity: {};",
                layer.opacity
            )
        })
        .collect();
    format!(
        "{header}\n:root {{\n{root}\n}}\n\n@supports (color: rgb(from black r g b / 0.3)) \
         {{\n  :root {{\n{relative}\n  }}\n}}\n\n:root {{\n  /* State layers: opacity of the \
         overlay on the content role. */\n{state}\n}}\n",
        header = header(
            "Material 3 static tokens: shape, typescale, motion, elevation, state layers.",
            "APHRODY_UPDATE_TOKENS=1 scripts/aphrody/build/rust/cargo-serial.sh test -p aphrody-m3-tokens \
             --test sheets_golden"
        ),
        root = root.join("\n"),
        relative = indent(&relative.join("\n")),
        state = state.join("\n"),
    )
}

/// A SpaceUI theme as an M3 scheme: tonal-spot relationships, the accent as a high-fidelity
/// primary palette, neutrals keyed on the theme's own surface hue and chroma.
#[must_use]
pub fn spaceui_scheme(theme: &Theme) -> DynamicScheme {
    let accent = Hct::from_argb(theme.accent);
    let neutral = Hct::from_argb(theme.neutral);
    let neutral_chroma = if neutral.chroma < 1.0 {
        0.0
    } else {
        neutral.chroma.min(12.0)
    };
    let palettes = Palettes {
        primary: TonalPalette::from_hct(accent),
        neutral: TonalPalette::from_hue_and_chroma(neutral.hue, neutral_chroma),
        neutral_variant: TonalPalette::from_hue_and_chroma(
            neutral.hue,
            if neutral_chroma == 0.0 {
                0.0
            } else {
                neutral_chroma + 4.0
            },
        ),
        ..Palettes::of(Variant::TonalSpot, &accent)
    };
    DynamicScheme::with_palettes(accent, Variant::TonalSpot, theme.dark, 0.0, palettes)
}

/// The SpaceUI themes as M3 schemes plus the SpaceUI compatibility aliases (`spaceui.css`).
#[must_use]
pub fn spaceui_css() -> String {
    let themes: Vec<String> = spaceui::THEMES
        .iter()
        .map(|theme| {
            let scheme = spaceui_scheme(theme);
            let mut vars = role_vars(&scheme);
            vars.extend(extended_vars(theme.accent, theme.dark));
            let mode = if theme.dark { "dark" } else { "light" };
            format!(
                "/* SpaceUI {} */\n{}",
                theme.name,
                block(
                    theme.selectors,
                    &vars,
                    &format!("  color-scheme: {mode};\n")
                )
            )
        })
        .collect();
    let mut aliases: Vec<String> = spaceui::ALIAS_MAP
        .iter()
        .map(|(token, source)| format!("  --color-{token}: {};", spaceui::css_value(source)))
        .collect();
    aliases.extend(spaceui::RADIUS_MAP.iter().map(|(token, corner)| {
        format!("  --radius-{token}: var(--md-sys-shape-corner-{corner});")
    }));
    aliases.push("  --font-sans: var(--md-ref-typeface-plain);".into());
    aliases.push("  --font-mono: var(--md-ref-typeface-code);".into());
    format!(
        "{header}\n/*\n * The seven SpaceUI themes (packages/aphrody-spaceui/packages/tokens) \
         rebuilt as M3\n * schemes: tonal-spot relationships, the SpaceUI accent as primary key \
         colour,\n * neutrals keyed on each theme's surface hue/chroma. Selectors match \
         upstream,\n * so `class=\"midnight-theme\"` keeps working. Dark is the default \
         (`:root`).\n *\n * The @theme block keeps every SpaceUI utility (`bg-app-box`, \
         `text-ink-dull`,\n * `border-app-line`, `bg-app-hover`, `rounded-window`) working on top \
         of the\n * M3 roles and state layers. It is an alternative to tokens.css' shadcn\n * \
         aliases (both define `--color-accent`): import one palette sheet.\n \
         */\n\n{themes}\n\n@theme inline {{\n{aliases}\n}}\n",
        header = header(
            "SpaceUI themes as Material 3 dynamic schemes, plus SpaceUI compatibility aliases.",
            "bun run generate:fusion"
        ),
        themes = themes.join("\n\n"),
        aliases = aliases.join("\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_sheet_declares_every_role_in_both_modes() {
        let css = tokens_css(BASELINE_SEED, Variant::TonalSpot, 0.0);
        for role in Role::ALL {
            let var = format!("--md-sys-color-{}:", role.name());
            assert_eq!(css.matches(&var).count(), 3, "{var}");
        }
        assert!(css.contains("--primary: var(--md-sys-color-primary);"));
        assert!(css.contains("--color-ring: var(--md-sys-color-primary);"));
        assert!(css.contains(":root.dark,\n.dark {"));
    }

    #[test]
    fn tailwind_sheet_covers_the_system() {
        let css = tailwind_css();
        assert_eq!(css.matches("  --color-").count(), 49 + 8);
        assert!(css.contains(
            "--color-surface-tint: var(--md-sys-color-surface-tint, var(--md-sys-color-primary));"
        ));
        assert!(css.contains("--breakpoint-medium: 37.5rem;"));
        assert!(css.contains("--breakpoint-large: 75rem;"));
        assert!(css.contains(
            "--ease-emphasized-accelerate: var(--md-sys-motion-easing-emphasized-accelerate);"
        ));
        assert!(css.contains("--md-ext-color-success: #"));
    }

    #[test]
    fn spaceui_sheet_has_every_theme_and_alias() {
        let css = spaceui_css();
        for theme in spaceui::THEMES {
            assert!(css.contains(&format!("/* SpaceUI {} */", theme.name)));
        }
        assert!(css.contains("--color-app-box: var(--md-sys-color-surface-container);"));
        let noir =
            &css[css.find("/* SpaceUI noir */").unwrap()..css.find("/* SpaceUI slate */").unwrap()];
        let surface = noir.split("--md-sys-color-surface: #").nth(1).unwrap();
        assert_eq!(
            &surface[0..2],
            &surface[2..4],
            "noir neutrals are achromatic"
        );
        assert_eq!(&surface[2..4], &surface[4..6]);
    }

    #[test]
    fn static_sheet_declares_every_family() {
        let css = static_css();
        assert_eq!(css.matches("--md-sys-shape-corner-").count(), 10);
        assert_eq!(css.matches("-tracking:").count(), 15);
        assert_eq!(css.matches("--md-sys-motion-duration-").count(), 16);
        assert_eq!(css.matches("--md-sys-motion-easing-").count(), 10);
        assert_eq!(css.matches("--md-sys-motion-spring-").count(), 12);
        for level in 1..=5 {
            assert_eq!(
                css.matches(&format!("--md-sys-elevation-level{level}:"))
                    .count(),
                2
            );
        }
        assert!(css.contains("--md-sys-typescale-display-large-tracking: -0.015625rem;"));
        assert!(css.contains("--md-sys-typescale-label-small-size: 0.6875rem;"));
        assert!(css.contains("--md-sys-motion-spring-default-spatial-damping: 0.9;"));
        assert!(css.contains("rgb(0 0 0 / 0.3)"));
        assert!(css.contains("--md-sys-state-hover-state-layer-opacity: 0.08;"));
        assert_eq!(
            render(&SheetRequest {
                sheet: Sheet::Static,
                ..SheetRequest::default()
            }),
            css
        );
    }

    #[test]
    fn render_dispatches() {
        let request = SheetRequest {
            sheet: Sheet::Scheme,
            dark: true,
            ..SheetRequest::default()
        };
        let css = render(&request);
        assert!(css.contains("color-scheme: dark;"));
        assert_eq!(css.matches("--md-sys-color-").count(), 49);
        assert_eq!(Sheet::from_name("spaceui"), Some(Sheet::Spaceui));
        assert_eq!(Sheet::from_name("brand"), Some(Sheet::Brand));
        assert_eq!(Sheet::from_name("gemini"), Some(Sheet::Brand));
        let brand_css = render(&SheetRequest {
            sheet: Sheet::Brand,
            ..SheetRequest::default()
        });
        assert!(brand_css.contains("--aphrody-brand-blue:"));
        assert!(brand_css.contains("--aphrody-spectrum-shift:"));
        assert_eq!(Sheet::from_name("components"), Some(Sheet::Components));
        let components = render(&SheetRequest {
            sheet: Sheet::Components,
            ..SheetRequest::default()
        });
        assert!(components.contains("--md-comp-switch-track-width: 52px;"));
        assert_eq!(Sheet::from_name("nope"), None);
    }
}
