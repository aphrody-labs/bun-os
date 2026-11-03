//! `bunos host` (the fork's `bun host`): `bun_host::cli::main` on the process arguments and stdio.
use std::io::Write;

fn main() {
    let args = std::env::args_os().skip(1).collect();
    let mut io = bun_host::cli::Io::default();
    let code = bun_host::cli::main(args, &mut io);
    let _ = std::io::stdout().write_all(io.out.as_bytes());
    let _ = std::io::stderr().write_all(io.err.as_bytes());
    std::process::exit(code);
}
