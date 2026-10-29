// SPDX-License-Identifier: GPL-3.0-or-later
//! Control plane of Waydroid for Bun OS. The logic is ported from the Python management tool
//! (`vendor/waydroid/tools`, Copyright Erfan Abdi, Oliver Smith and contributors, GPL-3.0-or-later).
//! See `docs/android/PROVENANCE.md` for the upstream commit and the file-by-file mapping.

pub mod binder;
pub mod cfg;
pub mod doctor;
pub mod lxc;
pub mod ota;
pub mod props;
