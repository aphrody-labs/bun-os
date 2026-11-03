// SPDX-License-Identifier: Apache-2.0
//! bunos-wsl-service: the Bun OS WSL 2 distro as a Windows service (`BunOSWsl`), and its systemd units as Windows
//! services (`BunOSWsl.<unit>`). Design and measurements: docs/WSL-SERVICE.md.

mod units;

#[cfg(windows)]
mod config;
#[cfg(windows)]
mod eventlog;
#[cfg(windows)]
mod instance;
#[cfg(windows)]
mod manage;
#[cfg(windows)]
mod proxy;
#[cfg(windows)]
mod user;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "bunos-wsl-service", version, about = "Bun OS on WSL as a Windows service")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Install or update the BunOSWsl service (elevated). Copies this binary to %SystemRoot%\BunOS\wsl-service.
    Install {
        #[arg(long, default_value = "bunos")]
        distro: String,
        /// Owner of the distro (`user` or `COMPUTER\user`); default: the calling user.
        #[arg(long)]
        user: Option<String>,
        /// Whether stopping the service also terminates the distro (default true; kept on reinstall).
        #[arg(long)]
        terminate_on_stop: Option<bool>,
        /// Start the service after installing.
        #[arg(long)]
        start: bool,
    },
    /// Stop and remove BunOSWsl and every unit service (elevated). The distro itself is untouched.
    Uninstall,
    /// Mirror systemd units as Windows services BunOSWsl.<unit> (elevated).
    Export { units: Vec<String> },
    /// Remove Windows mirrors of systemd units (elevated); the units keep running.
    Unexport { units: Vec<String> },
    /// List the distro's service units with their Windows mirror (read-only).
    Units {
        #[arg(long)]
        distro: Option<String>,
        #[arg(long)]
        json: bool,
        /// Include installed units that are not loaded.
        #[arg(long)]
        all: bool,
    },
    /// BunOSWsl state, last cold-start time and mirrored units.
    Status {
        #[arg(long)]
        json: bool,
    },
    /// Service entry point (SCM only).
    #[command(hide = true)]
    Instance,
    /// Unit service entry point (SCM only).
    #[command(hide = true)]
    Unit { unit: String },
}

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Install { distro, user, terminate_on_stop, start } => manage::install(distro, user, terminate_on_stop, start),
        Cmd::Uninstall => manage::uninstall(),
        Cmd::Export { units } => manage::export(&units),
        Cmd::Unexport { units } => manage::unexport(&units),
        Cmd::Units { distro, json, all } => manage::units(distro, json, all),
        Cmd::Status { json } => manage::status(json),
        Cmd::Instance => instance::dispatch(),
        Cmd::Unit { unit } => proxy::dispatch(&unit),
    }
}

#[cfg(not(windows))]
fn main() {
    let _ = Cli::parse();
    eprintln!("bunos-wsl-service runs on Windows only");
    std::process::exit(2);
}
