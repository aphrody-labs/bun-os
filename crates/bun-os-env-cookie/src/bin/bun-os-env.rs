//! `bunos env` (the fork's `bun env`): `bun_env_cookie::env_main` on the process arguments and stdio.
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let mut io = bun_env_cookie::Io::default();
    let code = bun_env_cookie::env_main(&args, &mut io);
    let _ = std::io::stdout().write_all(io.out.as_bytes());
    let _ = std::io::stderr().write_all(io.err.as_bytes());
    std::process::exit(code);
}
