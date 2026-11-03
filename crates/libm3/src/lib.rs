// SPDX-License-Identifier: Apache-2.0
//! Material 3 contracts independent of a window system, with optional COSMIC (`cosmic`) and Bevy
//! UI (`bevy`) renderers.
//! Material owns the native token engine. This crate adapts its values for application layouts
//! and COSMIC widgets; it does not maintain a separate color algorithm or token palette.
#![no_std]

#[cfg(any(feature = "cosmic", feature = "std", feature = "bevy"))]
extern crate std;

pub mod color;
pub mod component;
pub mod containers;
pub mod layout;
pub mod theme;
pub mod tokens;

#[cfg(feature = "cosmic")]
pub mod cosmic;

#[cfg(feature = "bevy")]
pub mod bevy;

pub use color::{Color, ColorScheme, Role};
pub use component::{Component, ComponentStyle, Interaction};
pub use layout::{ApplicationFamily, ApplicationLayout, WindowClass};
pub use m3_tokens as tokens_owner;

/// Shared component, accessibility and keyboard models; rendering remains a host adapter.
#[cfg(feature = "std")]
pub use m3_engine as components_owner;
#[cfg(feature = "std")]
pub use m3_engine::layout as composition;
#[cfg(feature = "std")]
pub use m3_engine::{a11y, components, controls, focus, forms, icons, keyboard, visual};
pub use theme::{Contrast, Density, Theme, ThemeMode};
