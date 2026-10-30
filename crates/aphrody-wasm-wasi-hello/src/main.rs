//! Prints one line per argument and the value of `HELLO`; exits with the argument count when it is above 3.
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    for arg in &args {
        println!("arg:{arg}");
    }
    println!("env:{}", std::env::var("HELLO").unwrap_or_default());
    if args.len() > 3 {
        ExitCode::from(args.len() as u8)
    } else {
        ExitCode::SUCCESS
    }
}
