// SPDX-License-Identifier: Apache-2.0
//! Windows to Linux path and environment translation, the same rules as `wslpath -u` and `WSLENV`
//! (Learn "Working across Windows and Linux file systems"): `C:\x` -> `/mnt/c/x`, `\\wsl.localhost\<distro>\x` and
//! `\\wsl$\<distro>\x` -> `/x`. Platform independent so it is unit-tested on both sides.

/// Translates one Windows path; `None` when it is not a drive or WSL UNC path.
pub fn to_linux(path: &str, mount_root: &str) -> Option<String> {
    let b = path.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b.len() == 2 || b[2] == b'\\' || b[2] == b'/') {
        let rest = path[2..].replace('\\', "/");
        let rest = rest.trim_end_matches('/');
        return Some(format!("{}/{}{}", mount_root.trim_end_matches('/'), (b[0] as char).to_ascii_lowercase(), rest));
    }
    let unc = path.replace('/', "\\");
    for prefix in ["\\\\wsl.localhost\\", "\\\\wsl$\\", "\\\\?\\UNC\\wsl.localhost\\", "\\\\?\\UNC\\wsl$\\"] {
        if unc.len() > prefix.len() && unc[..prefix.len()].eq_ignore_ascii_case(prefix) {
            let after = &unc[prefix.len()..];
            let rest = after.find('\\').map_or("", |i| &after[i..]);
            let rest = rest.replace('\\', "/");
            return Some(if rest.is_empty() { "/".into() } else { rest });
        }
    }
    if let Some(stripped) = path.strip_prefix("\\\\?\\") {
        return to_linux(stripped, mount_root);
    }
    None
}

/// Translates a command-line argument: drive/UNC paths everywhere in the argument after an `=` or at the start
/// (`--out=C:\x`), relative paths with backslashes when `exists` says the file is there. Other arguments pass as-is.
pub fn translate_arg(arg: &str, mount_root: &str, exists: impl Fn(&str) -> bool) -> String {
    if let Some(p) = to_linux(arg, mount_root) {
        return p;
    }
    if let Some(eq) = arg.find('=') {
        if arg.starts_with('-') {
            if let Some(p) = to_linux(&arg[eq + 1..], mount_root) {
                return format!("{}={p}", &arg[..eq]);
            }
        }
    }
    if arg.contains('\\') && !arg.starts_with('\\') && exists(arg) {
        return arg.replace('\\', "/");
    }
    arg.to_owned()
}

/// Environment forwarded from Windows, following `WSLENV` (`NAME`, `NAME/p` path, `NAME/l` path list, `NAME/u`
/// Windows-to-Linux only; `/w` entries are Linux-to-Windows and skipped). `TERM`, `COLORTERM`, `LANG` and
/// `NO_COLOR` always pass when set.
pub fn forwarded_env(get: impl Fn(&str) -> Option<String>, mount_root: &str) -> Vec<String> {
    let mut out = Vec::new();
    for name in ["TERM", "COLORTERM", "LANG", "NO_COLOR", "BUNOS_DEBUG"] {
        if let Some(v) = get(name) {
            out.push(format!("{name}={v}"));
        }
    }
    let Some(wslenv) = get("WSLENV") else { return out };
    for entry in wslenv.split(':').filter(|e| !e.is_empty()) {
        let (name, flags) = entry.split_once('/').unwrap_or((entry, ""));
        if flags.contains('w') || name.is_empty() {
            continue;
        }
        let Some(value) = get(name) else { continue };
        let value = if flags.contains('l') {
            value.split(';').filter(|s| !s.is_empty()).map(|p| to_linux(p, mount_root).unwrap_or_else(|| p.into())).collect::<Vec<_>>().join(":")
        } else if flags.contains('p') {
            to_linux(&value, mount_root).unwrap_or(value)
        } else {
            value
        };
        out.retain(|e: &String| !e.starts_with(&format!("{name}=")));
        out.push(format!("{name}={value}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drives() {
        assert_eq!(to_linux(r"C:\src\bun-os", "/mnt").unwrap(), "/mnt/c/src/bun-os");
        assert_eq!(to_linux(r"d:\", "/mnt").unwrap(), "/mnt/d");
        assert_eq!(to_linux("C:", "/mnt/").unwrap(), "/mnt/c");
        assert_eq!(to_linux(r"\\?\C:\x\y", "/mnt").unwrap(), "/mnt/c/x/y");
        assert_eq!(to_linux("relative\\x", "/mnt"), None);
        assert_eq!(to_linux("1:\\x", "/mnt"), None);
    }

    #[test]
    fn wsl_unc() {
        assert_eq!(to_linux(r"\\wsl.localhost\bunos\home\bun", "/mnt").unwrap(), "/home/bun");
        assert_eq!(to_linux(r"\\WSL$\bunos", "/mnt").unwrap(), "/");
        assert_eq!(to_linux("//wsl.localhost/bunos/usr/bin/ls", "/mnt").unwrap(), "/usr/bin/ls");
        assert_eq!(to_linux(r"\\server\share\x", "/mnt"), None);
    }

    #[test]
    fn args() {
        let no = |_: &str| false;
        assert_eq!(translate_arg(r"C:\a b\c.txt", "/mnt", no), "/mnt/c/a b/c.txt");
        assert_eq!(translate_arg(r"--out=C:\o", "/mnt", no), "--out=/mnt/c/o");
        assert_eq!(translate_arg(r"a\b", "/mnt", |_| true), "a/b");
        assert_eq!(translate_arg(r"a\b", "/mnt", no), r"a\b");
        assert_eq!(translate_arg("-la", "/mnt", no), "-la");
        assert_eq!(translate_arg("x=C:\\y", "/mnt", no), "x=C:\\y");
    }

    #[test]
    fn wslenv() {
        let env = |k: &str| match k {
            "WSLENV" => Some("GOPATH/l:USERPROFILE/pu:FOO:BAR/w".into()),
            "GOPATH" => Some(r"C:\go;D:\g2".into()),
            "USERPROFILE" => Some(r"C:\Users\me".into()),
            "FOO" => Some("1".into()),
            "BAR" => Some("2".into()),
            "TERM" => Some("xterm-256color".into()),
            _ => None,
        };
        assert_eq!(
            forwarded_env(env, "/mnt"),
            ["TERM=xterm-256color", "GOPATH=/mnt/c/go:/mnt/d/g2", "USERPROFILE=/mnt/c/Users/me", "FOO=1"]
        );
    }
}
