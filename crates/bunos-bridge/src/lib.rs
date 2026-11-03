// SPDX-License-Identifier: Apache-2.0
//! Bun OS Linux-Windows bridge (docs/LINUX-WINDOWS-BRIDGE.md): Windows-to-Linux path translation and the command
//! line `bunos-run` hands to `wsl.exe`.

pub mod path;

/// The `wsl.exe` arguments that run `program` with `args` in `distro`, in the Linux view of `cwd`.
/// `exists` tells whether a relative Windows path names an existing file (so `a\b` becomes `a/b`).
pub fn wsl_command(distro: &str, cwd: &str, program: &str, args: &[String], exists: impl Fn(&str) -> bool) -> Vec<String> {
    let mount = "/mnt";
    let mut out = vec!["-d".into(), distro.into()];
    if let Some(dir) = path::to_linux(cwd, mount) {
        out.extend(["--cd".into(), dir]);
    }
    out.push("--exec".into());
    out.push(path::to_linux(program, mount).unwrap_or_else(|| program.replace('\\', "/")));
    out.extend(args.iter().map(|a| path::translate_arg(a, mount, &exists)));
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn command_line() {
        let cmd = super::wsl_command(
            "bunos",
            r"C:\src\bun-os",
            r"\\wsl.localhost\bunos\usr\bin\ls",
            &["-la".into(), r"C:\Users".into()],
            |_| false,
        );
        assert_eq!(cmd, ["-d", "bunos", "--cd", "/mnt/c/src/bun-os", "--exec", "/usr/bin/ls", "-la", "/mnt/c/Users"]);
        let cmd = super::wsl_command("bunos", r"\\server\share", "ls", &[], |_| false);
        assert_eq!(cmd, ["-d", "bunos", "--exec", "ls"]);
    }
}
