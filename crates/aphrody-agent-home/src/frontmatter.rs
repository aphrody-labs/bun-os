// SPDX-License-Identifier: Apache-2.0
//! Tiny YAML-ish frontmatter parser shared by the typed docs (soul / identity
//! / user / tools).
//!
//! Deliberately not `serde_yaml` (the workspace dropped `serde_yml` over
//! RUSTSEC-2025-0068, and `serde_yaml` is archived). The persona schema only
//! needs `key: scalar`, inline flow lists `[a, b]`, and block lists
//! (`key:` then `  - item`). Anything richer belongs in the markdown body.

/// One frontmatter value: a scalar or a list of scalars.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FmValue {
    /// A single scalar string (already unquoted).
    Scalar(String),
    /// A list of scalar strings (already unquoted).
    List(Vec<String>),
}

/// Split a markdown document into its `---` frontmatter block and the body.
///
/// Returns `(Some(frontmatter), body)` when the document opens with a `---`
/// line and has a closing `---` line, else `(None, full_document)`. Mirrors
/// `workspace.ts::stripFrontMatter` but keeps the block so it can be typed.
/// A leading UTF-8 BOM is tolerated.
#[must_use]
pub fn split(input: &str) -> (Option<&str>, &str) {
    let trimmed = input.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return (None, input);
    }
    let after_open = match trimmed.split_once('\n') {
        Some((first, rest)) if first.trim_end() == "---" => rest,
        _ => return (None, input),
    };
    let mut idx = 0usize;
    for line in after_open.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let fm = &after_open[..idx];
            let body_start = idx + line.len();
            let body = after_open.get(body_start..).unwrap_or("").trim_start();
            return (Some(fm), body);
        }
        idx += line.len();
    }
    (None, input)
}

/// Parse a frontmatter block into ordered key -> value pairs. Tolerant:
/// comment lines (`#`) and malformed lines are skipped; block lists are folded
/// into the preceding key.
#[must_use]
pub fn parse(fm: &str) -> Vec<(String, FmValue)> {
    let mut out: Vec<(String, FmValue)> = Vec::new();
    let lines: Vec<&str> = fm.lines().collect();
    let mut i = 0usize;
    while i < lines.len() {
        let trimmed = lines[i].trim_end();
        if trimmed.trim().is_empty() || trimmed.trim_start().starts_with('#') {
            i += 1;
            continue;
        }
        let Some((raw_key, raw_val)) = trimmed.split_once(':') else {
            i += 1;
            continue;
        };
        let key = raw_key.trim().to_string();
        if key.is_empty() {
            i += 1;
            continue;
        }
        let val = raw_val.trim();
        if val.is_empty() {
            let mut items: Vec<String> = Vec::new();
            let mut j = i + 1;
            while j < lines.len() {
                let item = lines[j].trim_start();
                if let Some(rest) = item.strip_prefix("- ") {
                    items.push(unquote(rest.trim()));
                    j += 1;
                } else if item.is_empty() {
                    j += 1;
                } else {
                    break;
                }
            }
            if items.is_empty() {
                out.push((key, FmValue::Scalar(String::new())));
                i += 1;
            } else {
                out.push((key, FmValue::List(items)));
                i = j;
            }
        } else if let Some(inline) = parse_inline_list(val) {
            out.push((key, FmValue::List(inline)));
            i += 1;
        } else {
            out.push((key, FmValue::Scalar(unquote(val))));
            i += 1;
        }
    }
    out
}

/// Parse an inline flow list `[a, b, c]`; returns `None` when not bracketed.
fn parse_inline_list(val: &str) -> Option<Vec<String>> {
    let inner = val.strip_prefix('[')?.strip_suffix(']')?;
    if inner.trim().is_empty() {
        return Some(Vec::new());
    }
    Some(inner.split(',').map(|s| unquote(s.trim())).collect())
}

/// Strip a single matched pair of surrounding quotes.
#[must_use]
pub fn unquote(s: &str) -> String {
    let bytes = s.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// Quote a scalar for the frontmatter when [`parse`] would otherwise misread
/// it (leading/trailing space, a comment marker, a list bracket, a quote, or a
/// `: ` sequence). Double quotes are used unless the value contains one.
fn quote_scalar(value: &str) -> String {
    let needs = value.is_empty()
        || value.trim() != value
        || value.starts_with(['#', '[', '"', '\'', '-'])
        || value.contains(": ")
        || value.contains(" #");
    if !needs {
        return value.to_string();
    }
    if value.contains('"') {
        format!("'{value}'")
    } else {
        format!("\"{value}\"")
    }
}

/// Set (`Some`) or remove (`None`) top-level scalar keys in the frontmatter of
/// `content`, preserving every other key, comment and the markdown body.
///
/// A key that already exists is rewritten in place (a block list that followed
/// it is dropped); a new key is appended at the end of the block. A document
/// without frontmatter gains one. Values containing a line break are rejected
/// by flattening them to a single line, so the block can never be corrupted.
#[must_use]
pub fn upsert_scalars(content: &str, pairs: &[(&str, Option<&str>)]) -> String {
    let (fm, body) = split(content);
    let mut lines: Vec<String> = fm
        .map(|f| f.lines().map(str::to_string).collect())
        .unwrap_or_default();
    for (key, value) in pairs {
        let top_level_key = |line: &str| {
            !line.starts_with([' ', '\t'])
                && line.split_once(':').is_some_and(|(k, _)| k.trim() == *key)
        };
        let position = lines.iter().position(|l| top_level_key(l));
        if let Some(start) = position {
            // Remove the key line and any block-list items that belong to it.
            let mut end = start + 1;
            while end < lines.len() {
                let item = lines[end].trim_start();
                let indented = lines[end].starts_with([' ', '\t']);
                if indented && (item.starts_with("- ") || item.is_empty()) {
                    end += 1;
                } else {
                    break;
                }
            }
            lines.drain(start..end);
        }
        if let Some(v) = value {
            let flat = v.replace(['\r', '\n'], " ");
            let line = format!("{key}: {}", quote_scalar(flat.trim()));
            match position {
                Some(at) => lines.insert(at.min(lines.len()), line),
                None => lines.push(line),
            }
        }
    }
    let mut out = String::from("---\n");
    for line in &lines {
        out.push_str(line);
        out.push('\n');
    }
    out.push_str("---\n");
    if !body.is_empty() {
        out.push('\n');
        out.push_str(body);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_replaces_appends_and_removes_keys() {
        let src = "---\n# keep me\nname: Sam\ntags:\n  - a\n  - b\nlang: fr\n---\n\nBody.\n";
        let out = upsert_scalars(
            src,
            &[
                ("name", Some("Alex")),
                ("tags", None),
                ("avatar", Some("img/a.png")),
            ],
        );
        assert_eq!(
            out,
            "---\n# keep me\nname: Alex\nlang: fr\navatar: img/a.png\n---\n\nBody.\n"
        );
        let pairs = parse(split(&out).0.unwrap());
        assert!(
            pairs
                .iter()
                .any(|(k, v)| k == "avatar" && *v == FmValue::Scalar("img/a.png".into()))
        );
    }

    #[test]
    fn upsert_adds_frontmatter_and_round_trips_tricky_values() {
        let out = upsert_scalars(
            "Plain body\n",
            &[
                ("agent_id", Some("user:123")),
                ("note", Some("a: b # c")),
                ("q", Some("say \"hi\"")),
            ],
        );
        assert!(out.starts_with("---\n"));
        assert!(out.ends_with("\nPlain body\n"));
        let pairs = parse(split(&out).0.unwrap());
        assert_eq!(pairs[0].1, FmValue::Scalar("user:123".into()));
        assert_eq!(pairs[1].1, FmValue::Scalar("a: b # c".into()));
        assert_eq!(pairs[2].1, FmValue::Scalar("say \"hi\"".into()));
    }

    #[test]
    fn upsert_flattens_line_breaks() {
        let out = upsert_scalars("", &[("k", Some("a\nb: x"))]);
        let pairs = parse(split(&out).0.unwrap());
        assert_eq!(pairs, vec![("k".into(), FmValue::Scalar("a b: x".into()))]);
    }

    #[test]
    fn split_returns_none_without_frontmatter() {
        let (fm, body) = split("no frontmatter here\n");
        assert!(fm.is_none());
        assert_eq!(body, "no frontmatter here\n");
    }

    #[test]
    fn split_extracts_block_and_trims_body() {
        let (fm, body) = split("---\nkey: val\n---\n\n  body line\n");
        assert_eq!(fm, Some("key: val\n"));
        assert_eq!(body, "body line\n");
    }

    #[test]
    fn split_tolerates_bom() {
        let (fm, _body) = split("\u{feff}---\nk: v\n---\nx");
        assert_eq!(fm, Some("k: v\n"));
    }

    #[test]
    fn parse_handles_scalar_block_and_inline() {
        let pairs = parse("a: 1\nb:\n  - x\n  - y\nc: [m, n]\n");
        assert_eq!(pairs[0], ("a".into(), FmValue::Scalar("1".into())));
        assert_eq!(
            pairs[1],
            ("b".into(), FmValue::List(vec!["x".into(), "y".into()]))
        );
        assert_eq!(
            pairs[2],
            ("c".into(), FmValue::List(vec!["m".into(), "n".into()]))
        );
    }

    #[test]
    fn parse_skips_comments_and_blanks() {
        let pairs = parse("# comment\n\nk: v\n");
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "k");
    }

    #[test]
    fn unquote_strips_matched_quotes_only() {
        assert_eq!(unquote("\"hi\""), "hi");
        assert_eq!(unquote("'hi'"), "hi");
        assert_eq!(unquote("hi"), "hi");
        assert_eq!(unquote("\"hi"), "\"hi");
    }
}
