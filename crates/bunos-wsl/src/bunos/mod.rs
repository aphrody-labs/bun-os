// SPDX-License-Identifier: GPL-3.0-only
//! The Bun OS layer of the WSL manager: release manifest and checksums, `.wslconfig` kernel
//! selection, `wsl --status` parsing, Bun OS distro detection, session (compositor) preference and
//! the one-click install plan. Everything here is pure or goes through `WslCommandExecutor`, so it
//! is tested against fixtures and the mock executor; no WSL is started by the tests.

pub mod detect;
pub mod ini;
pub mod install;
pub mod manifest;
pub mod session;
pub mod status;

/// Name of the distro the Bun OS rootfs registers by default (`wsl-distribution.conf` `defaultName`).
pub const DEFAULT_DISTRO_NAME: &str = "bunos";
