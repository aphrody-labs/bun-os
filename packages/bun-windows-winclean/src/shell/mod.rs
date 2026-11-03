// SPDX-License-Identifier: Apache-2.0
//! The Windows shell surface the Bun OS shells and file manager share with Explorer: the Shell
//! namespace ([`namespace`]), WMI/CIM queries ([`wmi`]) and late-bound COM automation ([`com`]).
//! Reached as WinClean tools (`shell_*`, `wmi_query`, `com_invoke`) by `nu_plugin_windows`, the
//! `win` CLI, the aphrody MCP and COSMIC Files.

#[cfg(windows)]
pub mod com;
pub mod dispatch;
#[cfg(windows)]
pub mod namespace;
#[cfg(windows)]
pub mod popup;
#[cfg(windows)]
mod variant;
#[cfg(windows)]
pub mod wmi;
