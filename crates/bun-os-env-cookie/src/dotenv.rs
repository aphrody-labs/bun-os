//! `.env` documents: a parser that follows Bun's own (`bun_dotenv`), edits that keep comments,
//! order and line endings, and layered resolution in Bun's load order.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

const WS: &[u8] = b"\t\x0B\x0C \n\r";

fn is_key_byte(b: u8) -> bool {
    matches!(b, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-' | b'.')
}

pub(crate) fn is_valid_key(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(is_key_byte) && key != "export"
}

pub(crate) struct Entry {
    pub(crate) key: String,
    /// Decoded value, before `$VAR` expansion.
    pub(crate) value: String,
    /// Start of the line holding the key.
    pub(crate) line_start: usize,
    /// End of the last line of the entry, line terminator included.
    pub(crate) end: usize,
    /// Byte range of the value text, quotes included.
    pub(crate) value_start: usize,
    pub(crate) value_end: usize,
}

pub(crate) struct Doc {
    pub(crate) src: String,
    pub(crate) bom: bool,
    pub(crate) entries: Vec<Entry>,
}

struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn skip_line(&mut self) {
        match self.src[self.pos..]
            .iter()
            .position(|b| matches!(b, b'\n' | b'\r'))
        {
            Some(i) => self.pos += i + 1,
            None => self.pos = self.src.len(),
        }
    }

    fn skip_ws(&mut self) {
        while self.pos < self.src.len() && WS.contains(&self.src[self.pos]) {
            self.pos += 1;
        }
    }

    fn parse_key(&mut self, check_export: bool) -> Option<(usize, usize)> {
        if check_export {
            self.skip_ws();
        }
        let start = self.pos;
        let mut end = start;
        while end < self.src.len() && is_key_byte(self.src[end]) {
            end += 1;
        }
        if end < self.src.len() && start < end {
            self.pos = end;
            self.skip_ws();
            if self.pos < self.src.len() {
                if check_export
                    && end < self.pos
                    && &self.src[start..end] == b"export"
                    && let Some(key) = self.parse_key(false)
                {
                    return Some(key);
                }
                match self.src[self.pos] {
                    b'=' => {
                        self.pos += 1;
                        return Some((start, end));
                    }
                    b':' => {
                        let next = self.pos + 1;
                        if next < self.src.len() && WS.contains(&self.src[next]) {
                            self.pos += 2;
                            return Some((start, end));
                        }
                    }
                    _ => {}
                }
            }
        }
        self.pos = start;
        None
    }

    /// Decoded value (quotes stripped) and the offset just after the closing quote.
    fn parse_quoted(&self, quote: u8) -> Option<(Vec<u8>, usize)> {
        let start = self.pos;
        let mut end = start + 1;
        while end < self.src.len() {
            match self.src[end] {
                b'\\' => end += 1,
                q if q == quote => {
                    end += 1;
                    let mut out = Vec::new();
                    let mut i = start;
                    while i < end {
                        match self.src[i] {
                            b'\\' => {
                                if quote == b'"' {
                                    match self.src[i + 1] {
                                        b'n' => out.push(b'\n'),
                                        b'r' => out.push(b'\r'),
                                        other => out.extend_from_slice(&[b'\\', other]),
                                    }
                                    i += 2;
                                } else {
                                    out.push(b'\\');
                                    i += 1;
                                }
                            }
                            b'\r' => {
                                i += 1;
                                if i >= end || self.src[i] != b'\n' {
                                    out.push(b'\n');
                                }
                            }
                            c => {
                                out.push(c);
                                i += 1;
                            }
                        }
                    }
                    return Some((out[1..out.len() - 1].to_vec(), end));
                }
                _ => {}
            }
            end += 1;
        }
        None
    }

    /// (value start, value end, scan end, decoded value)
    fn parse_value(&mut self) -> (usize, usize, usize, Vec<u8>) {
        let start = self.pos;
        self.skip_ws();
        let first = self.pos;
        if first >= self.src.len() {
            return (start, start, start, Vec::new());
        }
        if matches!(self.src[first], b'`' | b'"' | b'\'')
            && let Some((value, end)) = self.parse_quoted(self.src[first])
        {
            self.pos = end;
            return (first, end, end, value);
        }
        let mut end = start;
        while end < self.src.len() && !matches!(self.src[end], b'#' | b'\r' | b'\n') {
            end += 1;
        }
        self.pos = end;
        let mut from = start;
        let mut to = end;
        while from < to && WS.contains(&self.src[from]) {
            from += 1;
        }
        while to > from && WS.contains(&self.src[to - 1]) {
            to -= 1;
        }
        if from == to {
            return (start, start, end, Vec::new());
        }
        (from, to, end, self.src[from..to].to_vec())
    }
}

fn parse_entries(src: &str) -> Vec<Entry> {
    let bytes = src.as_bytes();
    let mut parser = Parser { src: bytes, pos: 0 };
    let mut entries = Vec::new();
    while parser.pos < bytes.len() {
        let Some((ks, ke)) = parser.parse_key(true) else {
            parser.skip_line();
            continue;
        };
        let (value_start, value_end, scan_end, value) = parser.parse_value();
        let line_start = bytes[..ks]
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(0, |i| i + 1);
        let end = bytes[scan_end..]
            .iter()
            .position(|&b| b == b'\n')
            .map_or(bytes.len(), |i| scan_end + i + 1);
        entries.push(Entry {
            key: src[ks..ke].to_string(),
            value: String::from_utf8_lossy(&value).into_owned(),
            line_start,
            end,
            value_start,
            value_end,
        });
        if parser.pos < end {
            parser.pos = end;
        }
    }
    entries
}

impl Doc {
    pub(crate) fn parse(text: &str) -> Doc {
        let (bom, src) = match text.strip_prefix('\u{feff}') {
            Some(rest) => (true, rest),
            None => (false, text),
        };
        Doc {
            src: src.to_string(),
            bom,
            entries: parse_entries(src),
        }
    }

    pub(crate) fn render(&self) -> String {
        if self.bom {
            format!("\u{feff}{}", self.src)
        } else {
            self.src.clone()
        }
    }

    /// The definition Bun uses for `key` inside this file: a later one wins.
    pub(crate) fn last(&self, key: &str) -> Option<&Entry> {
        self.entries.iter().rev().find(|e| e.key == key)
    }

    /// Unique keys in first-appearance order, each with the value of its last definition.
    pub(crate) fn pairs(&self) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> = Vec::new();
        for entry in &self.entries {
            match pairs.iter_mut().find(|(k, _)| *k == entry.key) {
                Some(slot) => slot.1.clone_from(&entry.value),
                None => pairs.push((entry.key.clone(), entry.value.clone())),
            }
        }
        pairs
    }

    fn eol(&self) -> &'static str {
        if self.src.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        }
    }

    /// Replaces the last definition of `key` in place, or appends `KEY=value`.
    pub(crate) fn set(&mut self, key: &str, value: &str) -> Result<(), String> {
        if !is_valid_key(key) {
            return Err(format!(
                "invalid variable name {key:?}: use letters, digits, '_', '-' and '.'"
            ));
        }
        let text = format_value(value)?;
        match self.last(key).map(|e| (e.value_start, e.value_end)) {
            Some((start, end)) => self.src.replace_range(start..end, &text),
            None => {
                let eol = self.eol();
                if !self.src.is_empty() && !self.src.ends_with('\n') {
                    self.src.push_str(eol);
                }
                self.src.push_str(&format!("{key}={text}{eol}"));
            }
        }
        self.entries = parse_entries(&self.src);
        Ok(())
    }

    /// Removes every definition of `key`; returns how many were removed.
    pub(crate) fn unset(&mut self, key: &str) -> usize {
        let ranges: Vec<(usize, usize)> = self
            .entries
            .iter()
            .filter(|e| e.key == key)
            .map(|e| (e.line_start, e.end))
            .collect();
        for &(start, end) in ranges.iter().rev() {
            self.src.replace_range(start..end, "");
        }
        if !ranges.is_empty() {
            self.entries = parse_entries(&self.src);
        }
        ranges.len()
    }
}

fn expand_value(lookup: &dyn Fn(&[u8]) -> Option<Vec<u8>>, value: &str) -> String {
    if value.len() < 2 {
        return value.to_string();
    }
    let mut out = Vec::new();
    if expand_into(lookup, value.as_bytes(), &mut out, 0) {
        String::from_utf8_lossy(&out).into_owned()
    } else {
        value.to_string()
    }
}

fn decode_back(text: &str) -> Option<String> {
    let doc = Doc::parse(&format!("K={text}\n"));
    let [entry] = doc.entries.as_slice() else {
        return None;
    };
    if entry.key != "K" {
        return None;
    }
    Some(expand_value(&|_| None, &entry.value))
}

/// Text to put after `KEY=` so that Bun reads back exactly `value`.
pub(crate) fn format_value(value: &str) -> Result<String, String> {
    if value.is_empty() {
        return Ok(String::new());
    }
    let escaped = value.replace('$', "\\$");
    let bare_ok = !value.starts_with(['"', '\'', '`'])
        && !value.contains(['#', '\n', '\r'])
        && value.trim_matches(|c: char| c.is_ascii_whitespace()) == value;
    let mut candidates: Vec<String> = Vec::new();
    if bare_ok {
        candidates.push(escaped.clone());
    }
    candidates.push(format!(
        "\"{}\"",
        escaped.replace('\n', "\\n").replace('\r', "\\r")
    ));
    candidates.push(format!("'{escaped}'"));
    candidates.push(format!("`{escaped}`"));
    for candidate in candidates {
        if decode_back(&candidate).as_deref() == Some(value) {
            return Ok(candidate);
        }
    }
    Err("this value cannot be stored in a .env file that Bun reads back unchanged".to_string())
}

/// Port of Bun's `$NAME`, `${NAME}` and `${NAME:-default}` expansion. Returns whether anything
/// was rewritten.
fn expand_into(
    lookup: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
    value: &[u8],
    out: &mut Vec<u8>,
    depth: u8,
) -> bool {
    fn is_ident(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'_'
    }
    let mut pos = 0;
    let mut changed = false;
    while pos < value.len() {
        let b = value[pos];
        if b == b'\\' && value.get(pos + 1) == Some(&b'$') {
            out.push(b'$');
            pos += 2;
            changed = true;
            continue;
        }
        if b != b'$' || pos + 1 >= value.len() {
            out.push(b);
            pos += 1;
            continue;
        }
        let next = value[pos + 1];
        if next == b'{' {
            let inner_start = pos + 2;
            let mut i = inner_start;
            let mut nest = 1usize;
            let close = loop {
                if i >= value.len() {
                    break None;
                }
                match value[i] {
                    b'\\' if i + 1 < value.len() => i += 2,
                    b'$' if value.get(i + 1) == Some(&b'{') => {
                        nest += 1;
                        i += 2;
                    }
                    b'}' => {
                        nest -= 1;
                        if nest == 0 {
                            break Some(i);
                        }
                        i += 1;
                    }
                    _ => i += 1,
                }
            };
            let Some(close) = close else {
                out.extend_from_slice(&value[pos..]);
                break;
            };
            changed = true;
            let inner = &value[inner_start..close];
            let key_end = inner
                .iter()
                .position(|&c| !is_ident(c))
                .unwrap_or(inner.len());
            let key = &inner[..key_end];
            let rest = &inner[key_end..];
            if rest.is_empty() {
                if let Some(v) = lookup(key) {
                    out.extend_from_slice(&v);
                }
            } else if let Some(default) = rest.strip_prefix(b":-") {
                if let Some(v) = lookup(key) {
                    out.extend_from_slice(&v);
                } else if depth < 200 {
                    expand_into(lookup, default, out, depth + 1);
                } else {
                    out.extend_from_slice(default);
                }
            } else {
                out.extend_from_slice(&value[pos..=close]);
            }
            pos = close + 1;
            continue;
        }
        if is_ident(next) {
            changed = true;
            let key_start = pos + 1;
            let mut k = key_start;
            while k < value.len() && is_ident(value[k]) {
                k += 1;
            }
            if let Some(v) = lookup(&value[key_start..k]) {
                out.extend_from_slice(&v);
            }
            pos = k;
            continue;
        }
        out.push(b'$');
        pos += 1;
    }
    changed
}

pub(crate) struct Layer {
    /// Name shown to the user (`.env.local`, or the path given with `--file`).
    pub(crate) label: String,
    pub(crate) path: PathBuf,
    pub(crate) doc: Option<Doc>,
}

pub(crate) const SOURCE_PROCESS: &str = "process";

pub(crate) struct Var {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) source: String,
    /// Lower-precedence sources that define the same name.
    pub(crate) shadowed: Vec<String>,
}

impl Var {
    pub(crate) fn in_a_file(&self) -> bool {
        self.source != SOURCE_PROCESS || !self.shadowed.is_empty()
    }
}

fn norm(key: &str) -> String {
    if cfg!(windows) {
        key.to_ascii_lowercase()
    } else {
        key.to_string()
    }
}

/// Resolves variables the way `bun_dotenv::Loader` does: the process environment first, then the
/// layers from the highest to the lowest precedence; a name keeps the first value it gets, and the
/// values of each file are expanded against everything loaded so far.
pub(crate) fn resolve(
    layers_low_to_high: &[Layer],
    process: &BTreeMap<String, String>,
    include_process: bool,
    expand: bool,
) -> Vec<Var> {
    let mut vars: Vec<Var> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    if include_process {
        for (name, value) in process {
            index.insert(norm(name), vars.len());
            vars.push(Var {
                name: name.clone(),
                value: value.clone(),
                source: SOURCE_PROCESS.to_string(),
                shadowed: Vec::new(),
            });
        }
    }
    for layer in layers_low_to_high.iter().rev() {
        let Some(doc) = &layer.doc else { continue };
        let first_new = vars.len();
        for (name, value) in doc.pairs() {
            match index.get(&norm(&name)) {
                Some(&i) if i < first_new => vars[i].shadowed.push(layer.label.clone()),
                _ => {
                    index.insert(norm(&name), vars.len());
                    vars.push(Var {
                        name,
                        value,
                        source: layer.label.clone(),
                        shadowed: Vec::new(),
                    });
                }
            }
        }
        if !expand {
            continue;
        }
        for i in first_new..vars.len() {
            let lookup = |key: &[u8]| -> Option<Vec<u8>> {
                let key = std::str::from_utf8(key).ok()?;
                index
                    .get(&norm(key))
                    .map(|&j| vars[j].value.clone().into_bytes())
            };
            let expanded = expand_value(&lookup, &vars[i].value);
            vars[i].value = expanded;
        }
    }
    vars
}
