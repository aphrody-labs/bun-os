//! `bunos-utils`: Bun OS multicall binary. Started as an applet name (`ls`, `nm`, `ps`, ...;
//! through a link or `argv0`) it runs that applet; started as `bunos-utils` the first argument
//! names the applet. `bunos-utils --list` prints every applet and
//! `bunos-utils --install DIR` links each applet name to this binary in `DIR`.

use std::ffi::OsString;
use std::path::Path;
use std::process::ExitCode;

#[cfg(feature = "binutils")]
mod binutils;
#[cfg(feature = "binutils")]
mod binutils_write;
#[cfg(feature = "coreutils")]
mod coreutils;
#[cfg(feature = "diffutils")]
mod diffutils;
#[cfg(feature = "findutils")]
mod findutils;
#[cfg(all(feature = "procps", not(target_os = "linux")))]
mod procps;
#[cfg(all(feature = "procps", target_os = "linux"))]
mod procps_linux;
#[cfg(all(feature = "util-linux", target_os = "linux"))]
mod util_linux;

/// An applet entry point: full argv (`args[0]` is the applet name) to exit status.
pub type Main = fn(Vec<OsString>) -> ExitCode;

/// Exit status from a numeric code, clamped to 0..=255.
pub fn code(value: i32) -> ExitCode {
    ExitCode::from(value.clamp(0, 255) as u8)
}

/// Table of applets whose function returns an `i32` status.
#[macro_export]
macro_rules! applets {
    ($($name:literal => $f:path),* $(,)?) => {
        pub const APPLETS: &[(&str, $crate::Main)] = &[$(($name, |args| $crate::code($f(args)))),*];
    };
}

/// Table of uutils coreutils applets (`uumain` returns `i32`).
#[macro_export]
macro_rules! uu_applets {
    (all: [$($name:literal => $krate:ident,)*] cfg(unix): [$($uname:literal => $ukrate:ident,)*]) => {
        pub const APPLETS: &[(&str, $crate::Main)] = &[
            $(($name, |args| $crate::code($krate::uumain(args.into_iter()))),)*
            $(#[cfg(unix)] ($uname, |args| $crate::code($ukrate::uumain(args.into_iter()))),)*
        ];
    };
}

/// Table of uutils applets whose `uumain` returns `UResult<()>` from the given `uucore`.
#[macro_export]
macro_rules! uu_result_applets {
    ($uucore:ident: [$($name:literal => $krate:ident,)*]) => {
        /// `#[uucore::main]` turns `uumain` into `fn -> i32`; plain ones return `UResult<()>`.
        trait Status {
            fn status(self, name: &str) -> i32;
        }
        impl Status for i32 {
            fn status(self, _: &str) -> i32 {
                self
            }
        }
        impl Status for $uucore::error::UResult<()> {
            fn status(self, name: &str) -> i32 {
                use $uucore::error::UError as _;
                match self {
                    Ok(()) => $uucore::error::get_exit_code(),
                    Err(err) => {
                        let message = err.to_string();
                        if !message.is_empty() {
                            eprintln!("{name}: {message}");
                        }
                        err.code()
                    }
                }
            }
        }
        pub const APPLETS: &[(&str, $crate::Main)] = &[
            $(($name, |args| $crate::code(Status::status($krate::uumain(args.into_iter()), $name))),)*
        ];
    };
}

/// Every applet with its owner suite; one implementation per name.
fn applets() -> Vec<(&'static str, &'static str, Main)> {
    let mut all: Vec<(&'static str, &'static str, Main)> = Vec::new();
    let mut add = |suite: &'static str, table: &[(&'static str, Main)]| {
        all.extend(table.iter().map(|(n, m)| (*n, suite, *m)));
    };
    #[cfg(feature = "coreutils")]
    add("coreutils", coreutils::APPLETS);
    #[cfg(feature = "findutils")]
    add("findutils", findutils::APPLETS);
    #[cfg(feature = "diffutils")]
    add("diffutils", diffutils::APPLETS);
    #[cfg(all(feature = "procps", not(target_os = "linux")))]
    add("procps", procps::APPLETS);
    #[cfg(all(feature = "procps", target_os = "linux"))]
    add("procps", procps_linux::APPLETS);
    #[cfg(all(feature = "util-linux", target_os = "linux"))]
    add("util-linux", util_linux::APPLETS);
    #[cfg(feature = "binutils")]
    {
        add("binutils", binutils::APPLETS);
        add("binutils", binutils_write::APPLETS);
    }
    let _ = &mut add;
    all
}

fn applet_of(argv0: &OsString) -> String {
    let name = Path::new(argv0)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    match name.len().checked_sub(4) {
        Some(stem) if name[stem..].eq_ignore_ascii_case(".exe") => name[..stem].to_owned(),
        _ => name,
    }
}

fn install(dir: &Path) -> ExitCode {
    let Ok(exe) = std::env::current_exe() else {
        eprintln!("bunos-utils: cannot resolve its own path");
        return ExitCode::FAILURE;
    };
    if let Err(err) = std::fs::create_dir_all(dir) {
        eprintln!("bunos-utils: {}: {err}", dir.display());
        return ExitCode::FAILURE;
    }
    let mut status = ExitCode::SUCCESS;
    for (name, _, _) in applets() {
        let link = dir.join(name);
        let _ = std::fs::remove_file(&link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&exe, &link);
        #[cfg(not(unix))]
        let made = std::fs::hard_link(&exe, link.with_extension("exe"));
        if let Err(err) = made {
            eprintln!("bunos-utils: {}: {err}", link.display());
            status = ExitCode::FAILURE;
        }
    }
    status
}

fn main() -> ExitCode {
    let mut args: Vec<OsString> = std::env::args_os().collect();
    let mut name = args.first().map(applet_of).unwrap_or_default();
    // `coreutils` is the uutils multicall name Debian/Ubuntu install in /usr/bin (rust-coreutils).
    if name == "bunos-utils" || name == "coreutils" {
        args.remove(0);
        match args.first().and_then(|a| a.to_str()) {
            None | Some("--help" | "-h") => {
                println!("usage: bunos-utils <applet> [args...] | --list | --install DIR");
                return ExitCode::SUCCESS;
            }
            Some("--list") => {
                for (applet, suite, _) in applets() {
                    println!("{applet}\t{suite}");
                }
                return ExitCode::SUCCESS;
            }
            Some("--install") => {
                let Some(dir) = args.get(1) else {
                    eprintln!("bunos-utils: --install needs a directory");
                    return ExitCode::from(2);
                };
                return install(Path::new(dir));
            }
            Some(_) => name = applet_of(&args[0]),
        }
    }
    let Some((_, _, run)) = applets().into_iter().find(|(n, _, _)| *n == name) else {
        eprintln!("bunos-utils: {name}: applet not found");
        return ExitCode::from(127);
    };
    run(args)
}
