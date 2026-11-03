// SPDX-License-Identifier: Apache-2.0
//! `bunos-run <linux-program> [args...]`: runs a program of the Bun OS WSL distro from Windows as if it were an .exe,
//! as the invoking user: Windows paths in the program, arguments and working directory become Linux paths; stdin,
//! stdout and stderr are inherited; the exit code is returned. Environment crosses through `WSLENV` as wsl.exe
//! defines it. Registered as the handler of ELF files (docs/LINUX-WINDOWS-BRIDGE.md), so Explorer and cmd can launch
//! `foo` directly. `BUNOS_DISTRO` overrides the distro name (default `bunos`).
use std::path::Path;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let mut argv = std::env::args().skip(1);
    let Some(program) = argv.next() else {
        eprintln!("usage: bunos-run <linux-program> [args...]");
        return ExitCode::from(2);
    };
    let args: Vec<String> = argv.collect();
    let distro = std::env::var("BUNOS_DISTRO").unwrap_or_else(|_| "bunos".into());
    let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
    let wsl_args = bunos_bridge::wsl_command(&distro, &cwd, &program, &args, |p| Path::new(p).exists());
    let wsl = std::env::var("SystemRoot").map_or_else(|_| "wsl.exe".into(), |r| format!(r"{r}\System32\wsl.exe"));
    match Command::new(wsl).args(&wsl_args).status() {
        Ok(status) => ExitCode::from(status.code().map_or(1, |c| (c & 0xff) as u8)),
        Err(e) => {
            eprintln!("bunos-run: cannot start wsl.exe: {e}");
            ExitCode::from(127)
        }
    }
}
