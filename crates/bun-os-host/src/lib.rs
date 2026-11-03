//! `bunos host`: resource inventory of a machine (CPU, RAM, GPU, disks, kernel, OS, WireGuard IPs) and
//! the shared registry that merges the cards of several machines. The JSON schema in [`schema`] is
//! the single source of truth for the CLI, the registry files and the `host_*` MCP tools.

// Runs inside a CLI subcommand and an MCP tool, outside Bun's event loop, and spawns read-only
// probes: std I/O and std::process are intended here, as in `bun_vfs` and `bun_ssh`.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

pub mod cli;
pub mod collect;
pub mod environment;
pub mod parse;
pub mod registry;
pub mod schema;
pub mod tools;
pub mod transport;

pub use schema::{HostInfo, SCHEMA};

#[cfg(test)]
mod tests;
