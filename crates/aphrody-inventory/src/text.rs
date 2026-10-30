// SPDX-License-Identifier: Apache-2.0
//! Description text read from the members themselves: the first prose paragraph of a README, the leading comment of a
//! source file, the `description` of a Cargo manifest.

fn clip(text: &str, length: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= length {
        return flat;
    }
    let mut cut: String = flat.chars().take(length.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

/// Drop Markdown link targets and emphasis: `[text](url)` becomes `text`.
fn strip_markdown(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '`' => {}
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
            }
            ']' if chars.peek() == Some(&'(') => {
                for d in chars.by_ref() {
                    if d == ')' {
                        break;
                    }
                }
            }
            '[' => {}
            _ => out.push(c),
        }
    }
    out
}

/// First prose paragraph of a Markdown document (headings, quotes, tables, lists, images, HTML and code skipped).
pub fn first_paragraph(markdown: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut fence = false;
    for raw in markdown.lines() {
        let line = raw.trim();
        if line.starts_with("```") {
            fence = !fence;
            continue;
        }
        if fence {
            continue;
        }
        if line.is_empty() {
            if !lines.is_empty() {
                break;
            }
            continue;
        }
        let structural = [
            "#", ">", "|", "![", "[![", "<", "---", "===", "- ", "* ", "import ", "export ",
        ]
        .iter()
        .any(|p| line.starts_with(p))
            || line
                .split_once(". ")
                .is_some_and(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
        if structural {
            if !lines.is_empty() {
                break;
            }
            continue;
        }
        lines.push(strip_markdown(line));
    }
    clip(&lines.join(" "), 240)
}

/// Leading comment block of a source file (`//!`, `///`, `//`, `#` or a block comment), without license, shebang and
/// tooling lines.
pub fn header_text(text: &str, length: usize) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut block = false;
    for raw in text.lines().take(40) {
        let line = raw.trim();
        if line.is_empty() {
            if !out.is_empty() {
                break;
            }
            continue;
        }
        let body: String;
        if block {
            if line.contains("*/") {
                block = false;
            }
            body = line
                .trim_start_matches('*')
                .split("*/")
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
        } else if let Some(rest) = line.strip_prefix("/*") {
            block = !rest.contains("*/");
            body = rest
                .trim_start_matches('*')
                .trim_start_matches('!')
                .split("*/")
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
        } else if line.starts_with("//") {
            body = line
                .trim_start_matches('/')
                .trim_start_matches('!')
                .trim()
                .to_string();
        } else if line.starts_with('#') && !line.starts_with("#!") && !line.starts_with("#[") {
            body = line.trim_start_matches('#').trim().to_string();
        } else if out.is_empty()
            && ![
                "\"use ", "import ", "export ", "use ", "mod ", "pub ", "const ", "let ", "{",
                "#!", "#[",
            ]
            .iter()
            .any(|p| line.starts_with(p))
        {
            continue;
        } else {
            break;
        }
        let lower = body.to_ascii_lowercase();
        if body.is_empty()
            || [
                "spdx",
                "copyright",
                "eslint",
                "@ts-",
                "prettier",
                "biome",
                "-*-",
                "vim:",
            ]
            .iter()
            .any(|p| lower.starts_with(p))
        {
            continue;
        }
        out.push(body.replace("**", "").replace('`', ""));
        if out.join(" ").len() >= length {
            break;
        }
    }
    clip(&out.join(" "), length)
}

/// The `description = "..."` line of a Cargo manifest, without parsing the whole file.
pub fn toml_desc(text: &str) -> String {
    let Some(line) = text.lines().find(|l| l.starts_with("description")) else {
        return String::new();
    };
    match (line.find('"'), line.rfind('"')) {
        (Some(a), Some(b)) if b > a => line[a + 1..b].replace("\\\"", "\""),
        _ => String::new(),
    }
}

/// Files whose content is shown as text on their page.
pub fn is_text_name(name: &str) -> bool {
    const EXT: &[&str] = &[
        "md", "mdx", "json", "toml", "ts", "tsx", "js", "mjs", "sh", "ps1", "yaml", "yml", "rs",
        "txt", "conf", "css", "html", "py", "just", "lock", "cfg",
    ];
    let lower = name.to_ascii_lowercase();
    if ["justfile", "dockerfile", "license", "notice"]
        .iter()
        .any(|p| lower.starts_with(p))
    {
        return true;
    }
    lower
        .rsplit_once('.')
        .is_some_and(|(_, ext)| EXT.contains(&ext))
}

/// Current UTC time as RFC 3339 (seconds), without a date crate.
pub fn now_rfc3339() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    rfc3339(secs)
}

pub fn rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Seconds since the epoch of an RFC 3339 timestamp written by [`rfc3339`]; None for anything else.
pub fn parse_rfc3339(s: &str) -> Option<u64> {
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>());
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let mut t = time
        .trim_end_matches('Z')
        .split(':')
        .map(|p| p.split('.').next().unwrap_or("0").parse::<u64>());
    let (hh, mm, ss) = (
        t.next()?.ok()?,
        t.next()?.ok()?,
        t.next().unwrap_or(Ok(0)).ok()?,
    );
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days)
        .ok()
        .map(|d| d * 86_400 + hh * 3600 + mm * 60 + ss)
}
