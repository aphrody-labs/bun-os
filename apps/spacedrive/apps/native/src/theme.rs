//! SpaceUI design tokens for the gpui app, resolved from the canonical M3 owner
//! (`aphrody-m3-tokens`): the default SpaceUI theme becomes an M3 dynamic scheme
//! (`sheets::spaceui_scheme`) and every SpaceUI colour token resolves through
//! `spaceui::ALIAS_MAP` to an M3 role, a state layer or an extended colour, exactly
//! as `spaceui.css` does for the web interface.
//!
//! Field names transliterate the SpaceUI token names one-to-one
//! (`--color-app-box` → `app_box`, `--radius-lg` → `radius_lg`). Dark theme only for
//! now; the struct-of-values shape means later themes are data, not code.

use aphrody_m3_tokens::{
	blend::custom_color,
	role::Role,
	scheme::DynamicScheme,
	sheets::spaceui_scheme,
	spaceui::{self, Source},
};
use gpui::{px, rgb, App, Global, Hsla, Pixels};

/// The resolved colour of one SpaceUI token, as opaque `0xRRGGBB`.
fn resolve(scheme: &DynamicScheme, theme: &spaceui::Theme, token: &str) -> u32 {
	let role = |name: &str| {
		let role = Role::from_name(name).unwrap_or_else(|| panic!("unknown M3 role {name}"));
		scheme.argb(role) & 0x00FF_FFFF
	};
	let source = spaceui::ALIAS_MAP
		.iter()
		.find(|(name, _)| *name == token)
		.map(|(_, source)| *source)
		.unwrap_or_else(|| panic!("unknown SpaceUI token {token}"));
	match source {
		Source::Role(name) => role(name),
		Source::Layer {
			content,
			opacity,
			base,
		} => layer(role(content), opacity, role(base)),
		Source::Extended(name) => {
			let seed = spaceui::EXTENDED
				.iter()
				.find(|(extended, _)| *extended == name)
				.map(|(_, seed)| *seed)
				.unwrap_or_else(|| panic!("unknown extended colour {name}"));
			let group = custom_color(theme.accent, seed, true);
			let tones = if theme.dark { group.dark } else { group.light };
			tones.color & 0x00FF_FFFF
		}
	}
}

/// An M3 state layer: `content` at `opacity` composited over `base` (both `0xRRGGBB`).
fn layer(content: u32, opacity: f32, base: u32) -> u32 {
	let channel = |shift: u32| {
		let c = ((content >> shift) & 0xFF) as f32;
		let b = ((base >> shift) & 0xFF) as f32;
		((c * opacity + b * (1.0 - opacity)).round() as u32) << shift
	};
	channel(16) | channel(8) | channel(0)
}

/// `rem` at the CSS root font size of 16px.
const fn rem(value: f32) -> Pixels {
	px(value * 16.0)
}

/// The full SpaceUI token surface: colors, radii, and the type scale.
///
/// The whole surface is carried even though the scaffold reads only part of
/// it — completeness against theme.css is the contract that keeps drift
/// visible.
#[allow(dead_code)]
pub struct Theme {
	// Accent
	pub accent: Hsla,
	pub accent_faint: Hsla,
	pub accent_deep: Hsla,
	/// Labels and icons on an accent fill (M3 `on-primary`).
	pub on_accent: Hsla,

	// Text
	pub ink: Hsla,
	pub ink_dull: Hsla,
	pub ink_faint: Hsla,

	// App surfaces
	pub app: Hsla,
	pub app_box: Hsla,
	pub app_dark_box: Hsla,
	pub app_darker_box: Hsla,
	pub app_light_box: Hsla,
	pub app_overlay: Hsla,
	pub app_input: Hsla,
	pub app_focus: Hsla,
	pub app_line: Hsla,
	pub app_divider: Hsla,
	pub app_button: Hsla,
	pub app_selected: Hsla,
	pub app_selected_item: Hsla,
	pub app_hover: Hsla,
	pub app_active: Hsla,
	pub app_shade: Hsla,
	pub app_frame: Hsla,
	pub app_slider: Hsla,
	pub app_explorer_scrollbar: Hsla,

	// Sidebar
	pub sidebar: Hsla,
	pub sidebar_box: Hsla,
	pub sidebar_line: Hsla,
	pub sidebar_ink: Hsla,
	pub sidebar_ink_dull: Hsla,
	pub sidebar_ink_faint: Hsla,
	pub sidebar_divider: Hsla,
	pub sidebar_button: Hsla,
	pub sidebar_selected: Hsla,
	pub sidebar_shade: Hsla,

	// Menu
	pub menu: Hsla,
	pub menu_line: Hsla,
	pub menu_ink: Hsla,
	pub menu_faint: Hsla,
	pub menu_hover: Hsla,
	pub menu_selected: Hsla,
	pub menu_shade: Hsla,

	// Status
	pub status_success: Hsla,
	pub status_warning: Hsla,
	pub status_error: Hsla,
	pub status_info: Hsla,

	// design:content: ink and shade drawn over thumbnails and media, which stay
	// white-on-black whatever the scheme so they read on any image.
	pub media_ink: Hsla,
	pub media_shade: Hsla,

	// Border radius
	pub radius_window: Pixels,
	pub radius_lg: Pixels,
	pub radius_md: Pixels,

	// Type scale (Spacedrive's tighter scale; rem at a 16px root)
	pub text_tiny: Pixels,
	pub text_xs: Pixels,
	pub text_sm: Pixels,
	pub text_base: Pixels,
	pub text_lg: Pixels,
	pub text_xl: Pixels,
	pub text_2xl: Pixels,
	pub text_3xl: Pixels,
	pub text_4xl: Pixels,
	pub text_5xl: Pixels,
	pub text_6xl: Pixels,
	pub text_7xl: Pixels,
}

impl Theme {
	/// The default SpaceUI theme (dark) as an M3 scheme.
	pub fn dark() -> Self {
		let theme = &spaceui::THEMES[0];
		let scheme = spaceui_scheme(theme);
		let c = |token: &str| -> Hsla { rgb(resolve(&scheme, theme, token)).into() };
		Theme {
			accent: c("accent"),
			accent_faint: c("accent-faint"),
			accent_deep: c("accent-deep"),
			ink: c("ink"),
			ink_dull: c("ink-dull"),
			ink_faint: c("ink-faint"),
			app: c("app"),
			app_box: c("app-box"),
			app_dark_box: c("app-dark-box"),
			app_darker_box: c("app-darker-box"),
			app_light_box: c("app-light-box"),
			app_overlay: c("app-overlay"),
			app_input: c("app-input"),
			app_focus: c("app-focus"),
			app_line: c("app-line"),
			app_divider: c("app-divider"),
			app_button: c("app-button"),
			app_selected: c("app-selected"),
			app_selected_item: c("app-selected-item"),
			app_hover: c("app-hover"),
			app_active: c("app-active"),
			app_shade: c("app-shade"),
			app_frame: c("app-frame"),
			app_slider: c("app-slider"),
			app_explorer_scrollbar: c("app-explorer-scrollbar"),
			sidebar: c("sidebar"),
			sidebar_box: c("sidebar-box"),
			sidebar_line: c("sidebar-line"),
			sidebar_ink: c("sidebar-ink"),
			sidebar_ink_dull: c("sidebar-ink-dull"),
			sidebar_ink_faint: c("sidebar-ink-faint"),
			sidebar_divider: c("sidebar-divider"),
			sidebar_button: c("sidebar-button"),
			sidebar_selected: c("sidebar-selected"),
			sidebar_shade: c("sidebar-shade"),
			menu: c("menu"),
			menu_line: c("menu-line"),
			menu_ink: c("menu-ink"),
			menu_faint: c("menu-faint"),
			menu_hover: c("menu-hover"),
			menu_selected: c("menu-selected"),
			menu_shade: c("menu-shade"),
			status_success: c("status-success"),
			status_warning: c("status-warning"),
			status_error: c("status-error"),
			status_info: c("status-info"),
			on_accent: rgb(scheme.argb(Role::OnPrimary) & 0x00FF_FFFF).into(),
			media_ink: rgb(0xFFFFFF).into(),
			media_shade: rgb(0x000000).into(),

			radius_window: px(10.0),
			radius_lg: px(8.0),
			radius_md: px(6.0),

			text_tiny: rem(0.7),
			text_xs: rem(0.75),
			text_sm: rem(0.8),
			text_base: rem(1.0),
			text_lg: rem(1.125),
			text_xl: rem(1.25),
			text_2xl: rem(1.5),
			text_3xl: rem(1.875),
			text_4xl: rem(2.25),
			text_5xl: rem(3.0),
			text_6xl: rem(4.0),
			text_7xl: rem(5.0),
		}
	}

	/// Install the theme as the app-wide global.
	pub fn init(cx: &mut App) {
		cx.set_global(Theme::dark());
	}
}

impl Global for Theme {}

/// Access the SpaceUI theme from any context that derefs to [`App`].
///
/// gpui-component ships its own `ActiveTheme` returning its theme type; the
/// two must not be imported into the same module.
pub trait ActiveTheme {
	fn theme(&self) -> &Theme;
}

impl ActiveTheme for App {
	fn theme(&self) -> &Theme {
		self.global::<Theme>()
	}
}
