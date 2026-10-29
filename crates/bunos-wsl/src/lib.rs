// SPDX-License-Identifier: GPL-3.0-only
//! Bun OS WSL manager backend.
//!
//! Derived from `src-tauri/src` of octasoft-ltd/wsl-ui (GPL-3.0), see `docs/wsl/PROVENANCE.md`.
//! Nothing here depends on Tauri: the desktop shell (`apps/bunos-wsl/src-tauri`) and the
//! `bunos-wsl-cli` binary are thin front ends over the same operations.

pub mod actions;
pub mod bunos;
pub mod constants;
pub mod distro_catalog;
pub mod download;
pub mod error;
pub mod metadata;
pub mod oci;
pub mod settings;
pub mod temp_file_guard;
pub mod utils;
pub mod validation;
pub mod wsl;
