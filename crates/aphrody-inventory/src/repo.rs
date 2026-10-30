// SPDX-License-Identifier: Apache-2.0
//! The tracked files of a checkout (`git ls-files -s`), listed by directory, and safe reads below the root.

use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;

/// One direct child of a tracked directory.
#[derive(Debug, Clone)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
    /// Every tracked file below the entry (the entry itself for a file or a submodule).
    pub files: Vec<String>,
}

pub struct Repo {
    root: PathBuf,
    tracked: Vec<String>,
    set: HashSet<String>,
    gitlinks: HashSet<String>,
}

/// Documentation, templates, showcases and examples are not served, so they are not members.
pub fn excluded(name: &str) -> bool {
    if matches!(name, "docs" | "example" | "examples") {
        return true;
    }
    name.split(['-', '_']).any(|part| {
        matches!(
            part,
            "example" | "examples" | "showcase" | "showcases" | "template" | "templates"
        )
    })
}

impl Repo {
    pub fn open(root: &Path) -> std::io::Result<Repo> {
        let out = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["-c", "core.quotepath=off", "ls-files", "-s", "-z"])
            .output()?;
        if !out.status.success() {
            return Err(std::io::Error::other(format!(
                "git ls-files failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        let mut tracked = Vec::new();
        let mut gitlinks = HashSet::new();
        for record in out.stdout.split(|b| *b == 0).filter(|r| !r.is_empty()) {
            let record = String::from_utf8_lossy(record);
            let Some((meta, path)) = record.split_once('\t') else {
                continue;
            };
            if meta.starts_with("160000") {
                gitlinks.insert(path.to_string());
            }
            tracked.push(path.to_string());
        }
        tracked.sort();
        tracked.dedup();
        let set = tracked.iter().cloned().collect();
        Ok(Repo {
            root: root.to_path_buf(),
            tracked,
            set,
            gitlinks,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn has(&self, path: &str) -> bool {
        self.set.contains(path)
    }

    /// Direct children of a tracked directory ("" for the root), without dot entries and excluded names.
    pub fn children(&self, dir: &str) -> Vec<Entry> {
        let prefix = if dir.is_empty() {
            String::new()
        } else {
            format!("{dir}/")
        };
        let mut out: BTreeMap<String, Entry> = BTreeMap::new();
        for file in &self.tracked {
            let Some(rest) = file.strip_prefix(&prefix) else {
                continue;
            };
            let (name, nested) = match rest.split_once('/') {
                Some((n, _)) => (n, true),
                None => (rest, false),
            };
            if name.is_empty() || name.starts_with('.') || excluded(name) {
                continue;
            }
            let entry = out.entry(name.to_string()).or_insert_with(|| Entry {
                name: name.to_string(),
                dir: false,
                files: Vec::new(),
            });
            if nested || self.gitlinks.contains(file) {
                entry.dir = true;
            }
            entry.files.push(file.clone());
        }
        out.into_values().collect()
    }

    fn safe(&self, path: &str) -> Option<PathBuf> {
        if path.is_empty()
            || path
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
            || path.contains(['\\', ':', '\0'])
        {
            return None;
        }
        Some(self.root.join(path))
    }

    /// UTF-8 text of a file, cut at `limit` bytes on a character boundary.
    pub fn read_text(&self, path: &str, limit: usize) -> Option<String> {
        let bytes = std::fs::read(self.safe(path)?).ok()?;
        if bytes.contains(&0) {
            return None;
        }
        let text = String::from_utf8_lossy(&bytes);
        if text.len() <= limit {
            return Some(text.into_owned());
        }
        let mut end = limit;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        Some(format!("{}\n\n[truncated]", &text[..end]))
    }

    pub fn read_json(&self, path: &str) -> Option<Value> {
        let bytes = std::fs::read(self.safe(path)?).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// Commit of the checkout.
    pub fn head(&self) -> String {
        Command::new("git")
            .arg("-C")
            .arg(&self.root)
            .args(["rev-parse", "HEAD"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    }
}
