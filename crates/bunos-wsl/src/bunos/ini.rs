// SPDX-License-Identifier: GPL-3.0-only
//! Line-preserving editor for `.wslconfig` and `wsl.conf`: comments, unknown sections, key order
//! and the file's line ending are kept; only the requested key changes.

fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

fn section_name(line: &str) -> Option<String> {
    let t = line.trim();
    if t.starts_with('[') && t.ends_with(']') {
        Some(t[1..t.len() - 1].trim().to_ascii_lowercase())
    } else {
        None
    }
}

fn key_of(line: &str) -> Option<(String, &str)> {
    let t = line.trim_start();
    if t.is_empty() || t.starts_with('#') || t.starts_with(';') || t.starts_with('[') {
        return None;
    }
    let (k, v) = t.split_once('=')?;
    Some((k.trim().to_ascii_lowercase(), v))
}

/// Value of `key` in `section` (case-insensitive), without an inline comment.
pub fn get(text: &str, section: &str, key: &str) -> Option<String> {
    let (section, key) = (section.to_ascii_lowercase(), key.to_ascii_lowercase());
    let mut current = String::new();
    for line in text.lines() {
        if let Some(s) = section_name(line) {
            current = s;
        } else if current == section {
            if let Some((k, v)) = key_of(line) {
                if k == key {
                    return Some(strip_comment(v).trim().trim_matches('"').to_string());
                }
            }
        }
    }
    None
}

fn strip_comment(v: &str) -> &str {
    let mut in_quote = false;
    for (i, c) in v.char_indices() {
        match c {
            '"' => in_quote = !in_quote,
            '#' | ';' if !in_quote => return &v[..i],
            _ => {}
        }
    }
    v
}

/// Set `key=value` in `section`, replacing the first existing assignment or appending it to the
/// section (creating the section at the end when missing).
pub fn set(text: &str, section: &str, key: &str, value: &str) -> String {
    let eol = eol_of(text);
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let (sec_l, key_l) = (section.to_ascii_lowercase(), key.to_ascii_lowercase());
    let mut current = String::new();
    let mut last_in_section: Option<usize> = None;
    let mut section_seen = false;
    for i in 0..lines.len() {
        if let Some(s) = section_name(&lines[i]) {
            current = s;
            if current == sec_l {
                section_seen = true;
                last_in_section = Some(i);
            }
        } else if current == sec_l {
            if let Some((k, _)) = key_of(&lines[i]) {
                if k == key_l {
                    lines[i] = format!("{key}={value}");
                    return join(lines, eol);
                }
                last_in_section = Some(i);
            }
        }
    }
    let new_line = format!("{key}={value}");
    if section_seen {
        lines.insert(last_in_section.unwrap_or(lines.len() - 1) + 1, new_line);
    } else {
        if lines.last().is_some_and(|l| !l.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push(format!("[{section}]"));
        lines.push(new_line);
    }
    join(lines, eol)
}

/// Remove every assignment of `key` in `section`.
pub fn unset(text: &str, section: &str, key: &str) -> String {
    let eol = eol_of(text);
    let (sec_l, key_l) = (section.to_ascii_lowercase(), key.to_ascii_lowercase());
    let mut current = String::new();
    let kept: Vec<String> = text
        .lines()
        .filter(|line| {
            if let Some(s) = section_name(line) {
                current = s;
                return true;
            }
            !(current == sec_l && key_of(line).is_some_and(|(k, _)| k == key_l))
        })
        .map(str::to_string)
        .collect();
    join(kept, eol)
}

fn join(lines: Vec<String>, eol: &str) -> String {
    let mut out = lines.join(eol);
    out.push_str(eol);
    out
}

/// `.wslconfig` paths are written with doubled backslashes (`C:\\Users\\me\\bzImage`).
pub fn escape_windows_path(path: &str) -> String {
    path.replace("\\\\", "\\").replace('\\', "\\\\")
}

pub fn unescape_windows_path(value: &str) -> String {
    value.replace("\\\\", "\\")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# my config\r\n[wsl2]\r\nmemory=8GB ; cap\r\nkernel=C:\\\\old\\\\bzImage\r\n\r\n[experimental]\r\nsparseVhd=true\r\n";

    #[test]
    fn get_ignores_case_and_inline_comments() {
        assert_eq!(get(SAMPLE, "WSL2", "MEMORY").as_deref(), Some("8GB"));
        assert_eq!(get(SAMPLE, "experimental", "sparsevhd").as_deref(), Some("true"));
        assert_eq!(get(SAMPLE, "wsl2", "swap"), None);
    }

    #[test]
    fn set_replaces_in_place_and_keeps_everything_else() {
        let out = set(SAMPLE, "wsl2", "kernel", "C:\\\\new\\\\bzImage");
        assert!(out.contains("kernel=C:\\\\new\\\\bzImage\r\n"));
        assert!(out.contains("# my config\r\n"));
        assert!(out.contains("memory=8GB ; cap\r\n"));
        assert!(out.ends_with("sparseVhd=true\r\n"));
        assert!(!out.contains("old"));
    }

    #[test]
    fn set_appends_to_existing_section_before_the_next_one() {
        let out = set(SAMPLE, "wsl2", "kernelModules", "C:\\\\m.vhdx");
        let wsl2 = out.find("[wsl2]").unwrap();
        let exp = out.find("[experimental]").unwrap();
        let key = out.find("kernelModules=").unwrap();
        assert!(wsl2 < key && key < exp);
    }

    #[test]
    fn set_creates_missing_section_with_file_line_ending() {
        let out = set("[wsl2]\nmemory=4GB\n", "boot", "systemd", "true");
        assert_eq!(out, "[wsl2]\nmemory=4GB\n\n[boot]\nsystemd=true\n");
        assert_eq!(set("", "wsl2", "kernel", "x"), "[wsl2]\nkernel=x\n");
    }

    #[test]
    fn unset_removes_only_the_key_in_that_section() {
        let text = "[a]\nk=1\n[b]\nk=2\n";
        assert_eq!(unset(text, "a", "k"), "[a]\n[b]\nk=2\n");
    }

    #[test]
    fn windows_path_escaping_round_trips_and_is_idempotent() {
        let e = escape_windows_path("C:\\Users\\me\\bzImage");
        assert_eq!(e, "C:\\\\Users\\\\me\\\\bzImage");
        assert_eq!(escape_windows_path(&e), e);
        assert_eq!(unescape_windows_path(&e), "C:\\Users\\me\\bzImage");
    }
}
