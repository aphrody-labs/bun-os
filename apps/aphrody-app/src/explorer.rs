// SPDX-License-Identifier: Apache-2.0
//! Explorer backend: indexed search and volume tree on top of `aphrody-fsindex`.
//!
//! The file explorer UI is owned by `packages/app-ui` and the Spacedrive file service (`vendor/spacedrive`). This
//! module only adds host-side commands that consume the Apache-2.0 `aphrody-fsindex` crate, so the
//! unified explorer surface gets a fast search/tree backend without any source crossing the
//! licence boundary. Everything here is metadata only (path, name, kind, hidden flag, size, mtime):
//! file contents are never read.

use std::path::{Path, PathBuf};

use aphrody_fsindex::{FsIndex, MftTree, build_tree_walk};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Default and maximum number of entries returned by a single tree or search call.
const DEFAULT_LIMIT: usize = 5_000;
const MAX_LIMIT: usize = 500_000;

/// One explorer entry. Metadata only.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExplorerEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub hidden: bool,
}

/// A search hit from the persistent index. Metadata only.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExplorerHit {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub mtime_unix: i64,
    pub is_dir: bool,
}

/// Result of a tree build.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExplorerTree {
    /// `mft` (NTFS fast path) or `walk` (directory walk).
    pub source: &'static str,
    /// Entries returned (at most `limit`), directories first then by name.
    pub entries: Vec<ExplorerEntry>,
    /// Total entries in the tree (root excluded).
    pub total: usize,
    /// True when `total` exceeds the returned entries.
    pub truncated: bool,
}

fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir.join("explorer-index.sqlite"))
}

/// `C:`, `C:\` or `C:/` -> `C`; anything else is not a bare volume root.
#[cfg_attr(not(windows), allow(dead_code))]
fn volume_letter(root: &str) -> Option<char> {
    let mut chars = root.trim().chars();
    let letter = chars.next().filter(char::is_ascii_alphabetic)?;
    if chars.next()? != ':' {
        return None;
    }
    match chars.as_str() {
        "" | "\\" | "/" => Some(letter.to_ascii_uppercase()),
        _ => None,
    }
}

/// Full path of `frn`, rooted at `base`. `None` for orphans (missing or cyclic ancestors).
fn path_of(tree: &MftTree, frn: u128, base: &Path) -> Option<PathBuf> {
    let mut names = Vec::new();
    let mut cur = tree.get(frn)?;
    for _ in 0..=tree.len() {
        // The NTFS root (record 5) and a walk root (parent 0) both contribute no component.
        if MftTree::is_root(cur.frn) || cur.parent_frn == 0 {
            let mut out = base.to_path_buf();
            out.extend(names.iter().rev());
            return Some(out);
        }
        names.push(cur.name.as_str());
        cur = tree.get(cur.parent_frn)?;
    }
    None
}

/// Flatten `tree` into sorted DTOs rooted at `base`, capped at `limit`.
fn flatten(tree: &MftTree, base: &Path, limit: usize) -> (Vec<ExplorerEntry>, usize) {
    let mut entries = Vec::new();
    let mut total = 0usize;
    for entry in tree.iter() {
        if MftTree::is_root(entry.frn) || entry.parent_frn == 0 {
            continue;
        }
        total += 1;
        if entries.len() >= limit {
            continue;
        }
        if let Some(path) = path_of(tree, entry.frn, base) {
            entries.push(ExplorerEntry {
                path: path.to_string_lossy().into_owned(),
                name: entry.name.clone(),
                is_dir: entry.is_dir(),
                hidden: entry.is_hidden(),
            });
        }
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    (entries, total)
}

/// Build the tree for `root`: NTFS MFT fast path on Windows volume roots, directory walk otherwise.
fn build_tree(root: &str, limit: usize) -> Result<ExplorerTree, String> {
    let root = root.trim();
    if root.is_empty() {
        return Err("empty root".into());
    }
    #[cfg(windows)]
    if let Some(letter) = volume_letter(root) {
        // Needs elevation; any failure falls back to the walk below.
        if let Ok((tree, _next_usn, _journal)) = aphrody_fsindex::ntfs_win::scan_volume_tree(letter)
        {
            let base = PathBuf::from(format!("{letter}:\\"));
            let (entries, total) = flatten(&tree, &base, limit);
            return Ok(ExplorerTree {
                source: "mft",
                truncated: total > entries.len(),
                entries,
                total,
            });
        }
    }
    let base = PathBuf::from(root);
    if !base.is_dir() {
        return Err(format!("not a directory: {}", base.display()));
    }
    let tree = build_tree_walk(&base);
    let (entries, total) = flatten(&tree, &base, limit);
    Ok(ExplorerTree {
        source: "walk",
        truncated: total > entries.len(),
        entries,
        total,
    })
}

fn join_err(error: tauri::Error) -> String {
    format!("explorer task failed: {error}")
}

/// Build (or refresh) the persistent search index under `root`; returns the entries indexed.
#[tauri::command]
pub async fn aphrody_explorer_index_build(app: AppHandle, root: String) -> Result<usize, String> {
    let db = index_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root.trim());
        if !root.is_dir() {
            return Err(format!("not a directory: {}", root.display()));
        }
        let mut index = FsIndex::open(&db).map_err(|e| e.to_string())?;
        index.build(&root).map_err(|e| e.to_string())
    })
    .await
    .map_err(join_err)?
}

/// Search the persistent index by name/path terms.
#[tauri::command]
pub async fn aphrody_explorer_search(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ExplorerHit>, String> {
    let db = index_path(&app)?;
    let limit = clamp_limit(limit);
    tauri::async_runtime::spawn_blocking(move || {
        let index = FsIndex::open(&db).map_err(|e| e.to_string())?;
        let hits = index.search(&query, limit).map_err(|e| e.to_string())?;
        Ok(hits
            .into_iter()
            .map(|h| ExplorerHit {
                path: h.path,
                name: h.name,
                extension: h.extension,
                size: h.size,
                mtime_unix: h.mtime_unix,
                is_dir: h.is_dir,
            })
            .collect())
    })
    .await
    .map_err(join_err)?
}

/// Tree of `root` (flat, parent-resolved paths), via MFT on Windows volume roots else a walk.
#[tauri::command]
pub async fn aphrody_explorer_tree(
    root: String,
    limit: Option<usize>,
) -> Result<ExplorerTree, String> {
    let limit = clamp_limit(limit);
    tauri::async_runtime::spawn_blocking(move || build_tree(&root, limit))
        .await
        .map_err(join_err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_letter_accepts_only_bare_roots() {
        assert_eq!(volume_letter("c:"), Some('C'));
        assert_eq!(volume_letter("D:\\"), Some('D'));
        assert_eq!(volume_letter("E:/"), Some('E'));
        assert_eq!(volume_letter("C:\\Users"), None);
        assert_eq!(volume_letter("/home"), None);
    }

    #[test]
    fn walk_tree_flattens_with_real_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(dir.path().join("sub")).expect("sub");
        std::fs::write(dir.path().join("sub").join("b.txt"), b"y").expect("b");
        std::fs::write(dir.path().join(".h"), b"z").expect("h");
        let tree = build_tree(&dir.path().to_string_lossy(), 100).expect("tree");
        assert_eq!(tree.source, "walk");
        assert_eq!(tree.total, 3);
        assert!(!tree.truncated);
        assert!(tree.entries[0].is_dir, "directories first");
        let b = tree
            .entries
            .iter()
            .find(|e| e.name == "b.txt")
            .expect("b.txt");
        assert_eq!(Path::new(&b.path), dir.path().join("sub").join("b.txt"));
        assert!(tree.entries.iter().any(|e| e.name == ".h" && e.hidden));
    }

    #[test]
    fn limit_truncates() {
        let dir = tempfile::tempdir().expect("tempdir");
        for n in 0..5 {
            std::fs::write(dir.path().join(format!("f{n}")), b"x").expect("f");
        }
        let tree = build_tree(&dir.path().to_string_lossy(), 2).expect("tree");
        assert_eq!(tree.entries.len(), 2);
        assert_eq!(tree.total, 5);
        assert!(tree.truncated);
    }

    #[test]
    fn missing_root_is_an_error() {
        assert!(build_tree("/definitely/not/here", 10).is_err());
        assert!(build_tree("  ", 10).is_err());
    }
}
