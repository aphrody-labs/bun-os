// SPDX-License-Identifier: GPL-3.0-or-later
//! LXC configuration assembly (`lxc.set_lxc_config`): `config_base` plus the per-version snippets,
//! with the architecture and post-stop hook substituted.

/// Major version of `lxc-start --version` output ("5.0.3" -> 5). 0 when unparsable.
pub fn parse_version(output: &str) -> u32 {
    output
        .trim()
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

/// Which `config_<n>` snippets apply: version 1 for lxc <= 2, then every 3..=4 not above the host version.
pub fn snippet_versions(lxc_major: u32, available: &[u32]) -> Vec<u32> {
    if lxc_major == 0 {
        return vec![];
    }
    if lxc_major <= 2 {
        return vec![1];
    }
    (3..5).filter(|v| lxc_major >= *v && available.contains(v)).collect()
}

/// Concatenate `base` and the chosen snippets, then substitute `LXCARCH` and `LXCPOSTSTOP`
/// (first occurrence of each per line, like `sed s///`). With `apparmor`, `unconfined` profiles
/// are replaced by `profile`.
pub fn render(base: &str, snippets: &[&str], arch: &str, post_stop: &str, apparmor: Option<&str>) -> String {
    let mut text = String::from(base);
    for s in snippets {
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(s);
    }
    let mut out = String::new();
    for line in text.lines() {
        let mut l = line.replacen("LXCARCH", arch, 1).replacen("LXCPOSTSTOP", post_stop, 1);
        if let Some(p) = apparmor
            && (l.contains("lxc.aa_profile") || l.contains("lxc.apparmor.profile"))
        {
            l = l.replace("unconfined", p);
        }
        out.push_str(&l);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(parse_version("5.0.3\n"), 5);
        assert_eq!(parse_version("junk"), 0);
        assert_eq!(snippet_versions(2, &[1, 3, 4]), vec![1]);
        assert_eq!(snippet_versions(3, &[1, 3, 4]), vec![3]);
        assert_eq!(snippet_versions(5, &[1, 3, 4]), vec![3, 4]);
        assert!(snippet_versions(0, &[3]).is_empty());
    }

    #[test]
    fn render_substitutes() {
        let base = "lxc.arch = LXCARCH\nlxc.hook.post-stop = LXCPOSTSTOP\nlxc.apparmor.profile = unconfined";
        let out = render(base, &["lxc.pty.max = 10\n"], "x86_64", "/p/stop.sh", Some("lxc-waydroid"));
        assert!(out.contains("lxc.arch = x86_64\n"));
        assert!(out.contains("post-stop = /p/stop.sh\n"));
        assert!(out.contains("lxc.apparmor.profile = lxc-waydroid\n"));
        assert!(out.contains("lxc.pty.max = 10\n"));
        assert!(render(base, &[], "arm64", "x", None).contains("= unconfined"));
    }
}
