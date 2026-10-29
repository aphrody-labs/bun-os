#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unimplemented,
    clippy::todo,
    clippy::unreachable
)]

//! Small, reusable egui components for the Craft frontends.
//!
//! Applications own their layouts, commands and document semantics. Shared chrome derives
//! from Aphrody identity and M3 through [`theme::aphrody`]; no application engine is required.

pub mod brand;
pub mod buttons;
pub mod docking;
pub mod icons;
pub mod layout;
pub mod printing;
pub mod tabs;
pub mod theme;
