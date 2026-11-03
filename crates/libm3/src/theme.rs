// SPDX-License-Identifier: Apache-2.0
use crate::{
    ColorScheme,
    tokens::{Motion, SHAPES, Shapes, TYPOGRAPHY, Typography},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Density {
    Touch,
    Desktop,
    Compact,
}

impl Density {
    pub const fn target_height(self) -> u16 {
        match self {
            Self::Touch => 48,
            Self::Desktop => 40,
            Self::Compact => 32,
        }
    }
    pub const fn gap(self) -> u16 {
        match self {
            Self::Touch => 16,
            Self::Desktop => 12,
            Self::Compact => 8,
        }
    }
}

/// The three M3 contrast levels: the user setting, or `prefers-contrast: more` / the OS
/// high-contrast flag selecting [`Contrast::High`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Contrast {
    #[default]
    Standard,
    Medium,
    High,
}

impl Contrast {
    /// The MCU contrast level of the dynamic scheme (0, 0.5 and 1).
    pub const fn level(self) -> f64 {
        match self {
            Self::Standard => 0.0,
            Self::Medium => 0.5,
            Self::High => 1.0,
        }
    }

    /// High when the host reports a high-contrast preference, standard otherwise.
    pub const fn from_high_contrast(high_contrast: bool) -> Self {
        if high_contrast {
            Self::High
        } else {
            Self::Standard
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Theme {
    pub mode: ThemeMode,
    pub colors: ColorScheme,
    pub typography: Typography,
    pub shapes: Shapes,
    pub density: Density,
    pub motion: Motion,
}

impl Theme {
    #[cfg(feature = "std")]
    pub fn light() -> Self {
        Self::from_request(ThemeMode::Light, m3_tokens::theme::ThemeRequest::default())
    }
    #[cfg(feature = "std")]
    pub fn dark() -> Self {
        Self::from_request(ThemeMode::Dark, m3_tokens::theme::ThemeRequest::default())
    }
    /// The Bun OS product theme: the identity seed (`aphrody_identity::design::pet_seed_hex`),
    /// Tonal Spot, at the requested contrast level, in light or dark mode.
    #[cfg(feature = "std")]
    pub fn aphrody(dark: bool, contrast: Contrast) -> Self {
        let request = m3_engine::theme::Theme::aphrody_request();
        let request = m3_tokens::theme::ThemeRequest::new(
            request.seed(),
            request.variant(),
            contrast.level(),
        )
        .expect("the identity seed is opaque and every contrast level is in range");
        Self::from_request(
            if dark {
                ThemeMode::Dark
            } else {
                ThemeMode::Light
            },
            request,
        )
    }
    #[cfg(feature = "std")]
    pub fn from_request(mode: ThemeMode, request: m3_tokens::theme::ThemeRequest) -> Self {
        Self::new(
            mode,
            ColorScheme::from_dynamic(&request.scheme(mode == ThemeMode::Dark)),
        )
    }
    /// Use the native owner's seed, nine variants and validated contrast contract.
    #[cfg(feature = "std")]
    pub fn from_seed(
        mode: ThemeMode,
        seed: u32,
        variant: m3_tokens::scheme::Variant,
        contrast: f64,
    ) -> Result<Self, std::string::String> {
        Ok(Self::from_request(
            mode,
            m3_tokens::theme::ThemeRequest::new(seed, variant, contrast)?,
        ))
    }
    pub const fn new(mode: ThemeMode, colors: ColorScheme) -> Self {
        Self {
            mode,
            colors,
            typography: TYPOGRAPHY,
            shapes: SHAPES,
            density: Density::Desktop,
            motion: Motion::Standard,
        }
    }
    pub const fn performance(mut self) -> Self {
        self.motion = Motion::Reduced;
        self.density = Density::Compact;
        self
    }
}

#[cfg(feature = "std")]
impl Default for Theme {
    fn default() -> Self {
        Self::light()
    }
}

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::{Contrast, Theme, ThemeMode};
    use crate::Role;

    #[test]
    fn product_theme_uses_the_identity_seed_at_every_contrast_level() {
        let standard = Theme::aphrody(true, Contrast::Standard);
        let high = Theme::aphrody(true, Contrast::High);
        assert_eq!(standard.mode, ThemeMode::Dark);
        assert_eq!(
            Theme::aphrody(false, Contrast::Medium).mode,
            ThemeMode::Light
        );
        assert_ne!(standard.colors, Theme::dark().colors);
        assert_ne!(
            standard.colors.get(Role::OnSurfaceVariant),
            high.colors.get(Role::OnSurfaceVariant)
        );
        assert_eq!(Contrast::from_high_contrast(true), Contrast::High);
    }
}
