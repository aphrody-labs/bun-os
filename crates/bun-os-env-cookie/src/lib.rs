//! `bunos env` (.env files) and `bunos cookie` (cookie jars on disk). Both commands run before the
//! runtime starts; the dispatch lives in `bun_runtime::cli`.

// Runs inside a CLI subcommand, outside Bun's event loop: std I/O is intended here, as in
// `bun_host` and `bun_vfs`.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

mod args;
mod cookie_cli;
mod dotenv;
mod env_cli;
mod fsutil;
mod jar;
mod mask;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::PathBuf;

pub use cookie_cli::main as cookie_main;
pub use env_cli::main as env_main;

/// Captured output and injectable process state of one command invocation.
#[derive(Default)]
pub struct Io {
    pub out: String,
    pub err: String,
    /// Replaces standard input (read lazily from the process when `None`).
    pub stdin: Option<String>,
    /// Replaces the process environment when `Some`.
    pub environ: Option<BTreeMap<String, String>>,
    /// Replaces the current directory when `Some`.
    pub cwd: Option<PathBuf>,
    /// Replaces the current time (seconds since the Unix epoch) when `Some`.
    pub now: Option<f64>,
}

impl Io {
    pub(crate) fn environ_map(&self) -> BTreeMap<String, String> {
        match &self.environ {
            Some(map) => map.clone(),
            None => std::env::vars_os()
                .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
                .collect(),
        }
    }

    pub(crate) fn env_var(&self, key: &str) -> Option<String> {
        match &self.environ {
            Some(map) => map.get(key).cloned(),
            None => std::env::var(key).ok(),
        }
    }

    pub(crate) fn current_dir(&self) -> Result<PathBuf, String> {
        match &self.cwd {
            Some(dir) => Ok(dir.clone()),
            None => std::env::current_dir()
                .map_err(|e| format!("cannot read the current directory: {e}")),
        }
    }

    pub(crate) fn read_stdin(&mut self) -> Result<String, String> {
        if let Some(text) = &self.stdin {
            return Ok(text.clone());
        }
        let mut text = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin(), &mut text)
            .map_err(|e| format!("cannot read standard input: {e}"))?;
        self.stdin = Some(text.clone());
        Ok(text)
    }

    pub(crate) fn now_secs(&self) -> f64 {
        self.now.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0)
        })
    }
}

macro_rules! outln {
    ($io:expr, $($arg:tt)*) => {{
        use std::fmt::Write as _;
        let _ = writeln!($io.out, $($arg)*);
    }};
}
macro_rules! errln {
    ($io:expr, $($arg:tt)*) => {{
        use std::fmt::Write as _;
        let _ = writeln!($io.err, $($arg)*);
    }};
}
pub(crate) use {errln, outln};
