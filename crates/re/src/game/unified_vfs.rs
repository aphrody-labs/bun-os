// SPDX-License-Identifier: Apache-2.0
//! One mounted view over several game installs at once — the merge of Inazuma Eleven and
//! Dragon Ball Xenoverse 2 into a single streamed namespace.
//!
//! Each install keeps its own [`GameVfs`]: its detected profile, archive mount order and
//! on-demand streaming reads (CPK/CRI entries are read by index, nothing is extracted on
//! mount). The unified layer adds only a `<game>/<path>` prefix, so both games' assets are
//! listed, found and read through a single handle. The game label is the mounted profile id
//! (`ievr`, `dbxv2`), made unique with a numeric suffix when two installs resolve to the same
//! one.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::assets::vfs::{GameVfs, MountOptions, VfsEntry};
use super::assets::{AssetError, AssetResult};

/// One install mounted into the unified view.
pub struct UnifiedMount {
    /// Unique game label (profile id, suffixed on collision).
    pub game: String,
    /// The per-install streamed view.
    pub vfs: GameVfs,
}

/// A streamed view over several installs sharing one `<game>/<path>` namespace.
#[derive(Default)]
pub struct UnifiedVfs {
    mounts: Vec<UnifiedMount>,
}

/// Summary of one mounted game in the unified view.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedGame {
    /// Unique label the game is addressed by.
    pub game: String,
    /// Profile id the install was mounted with.
    pub profile: &'static str,
    /// Install root.
    pub root: PathBuf,
    /// Entries this game contributes.
    pub entries: usize,
}

impl UnifiedVfs {
    /// Mount each install and present them under one `<game>/<path>` namespace.
    ///
    /// Each root is detected and mounted with `options` (its profile auto-selected unless
    /// `options.profile` is set, which would force the same profile on every root — mount one
    /// install at a time if you need different profiles). Labels are the profile ids,
    /// deduplicated with a numeric suffix.
    ///
    /// # Errors
    /// Propagates the first mount error: a root cannot be listed, or a delegated owner refuses
    /// the install.
    pub fn mount(installs: &[PathBuf], options: &MountOptions) -> AssetResult<Self> {
        let mut unified = Self::default();
        for root in installs {
            let vfs = GameVfs::mount(root, options)?;
            let labels: Vec<&str> = unified.mounts.iter().map(|m| m.game.as_str()).collect();
            let game = unique_label(&labels, vfs.profile().id);
            unified.mounts.push(UnifiedMount { game, vfs });
        }
        Ok(unified)
    }

    /// Add an already-mounted install under a chosen (deduplicated) label.
    pub fn push(&mut self, vfs: GameVfs) -> &str {
        let labels: Vec<&str> = self.mounts.iter().map(|m| m.game.as_str()).collect();
        let game = unique_label(&labels, vfs.profile().id);
        self.mounts.push(UnifiedMount { game, vfs });
        &self.mounts.last().expect("just pushed").game
    }

    /// The mounted games and their entry counts.
    #[must_use]
    pub fn games(&self) -> Vec<UnifiedGame> {
        self.mounts
            .iter()
            .map(|mount| UnifiedGame {
                game: mount.game.clone(),
                profile: mount.vfs.profile().id,
                root: mount.vfs.root().to_path_buf(),
                entries: mount.vfs.entries().len(),
            })
            .collect()
    }

    /// Total entry count across every game.
    #[must_use]
    pub fn len(&self) -> usize {
        self.mounts
            .iter()
            .map(|mount| mount.vfs.entries().len())
            .sum()
    }

    /// Whether no game contributes any entry.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Iterate `(game, entry)` across every mount, in mount order.
    pub fn entries(&self) -> impl Iterator<Item = (&str, &VfsEntry)> {
        self.mounts.iter().flat_map(|mount| {
            mount
                .vfs
                .entries()
                .iter()
                .map(move |entry| (mount.game.as_str(), entry))
        })
    }

    /// Split a unified path `"<game>/<rest>"` into its owning mount and the per-game path.
    fn split<'a>(&self, path: &'a str) -> Option<(&UnifiedMount, &'a str)> {
        let (game, rest) = path.split_once('/')?;
        let mount = self
            .mounts
            .iter()
            .find(|mount| mount.game.eq_ignore_ascii_case(game))?;
        Some((mount, rest))
    }

    /// Find an entry by unified path `"<game>/<path>"`.
    #[must_use]
    pub fn find(&self, path: &str) -> Option<(&str, &VfsEntry)> {
        let (mount, rest) = self.split(path)?;
        mount
            .vfs
            .find(rest)
            .map(|entry| (mount.game.as_str(), entry))
    }

    /// Read an entry by unified path `"<game>/<path>"`, streamed from its container.
    ///
    /// # Errors
    /// Unknown game prefix or missing entry ([`AssetError::NotFound`]), or a container/key
    /// error from the owning mount.
    pub fn read(&self, path: &str) -> AssetResult<Vec<u8>> {
        let (mount, rest) = self
            .split(path)
            .ok_or_else(|| AssetError::NotFound(path.to_string()))?;
        mount.vfs.read(rest)
    }

    /// Aggregate stats: each game's own stats plus combined entry and byte totals.
    #[must_use]
    pub fn stats(&self) -> serde_json::Value {
        let per_game: Vec<serde_json::Value> = self
            .mounts
            .iter()
            .map(|mount| {
                serde_json::json!({
                    "game": mount.game,
                    "profile": mount.vfs.profile().id,
                    "stats": mount.vfs.stats(),
                })
            })
            .collect();
        let total_bytes: u64 = self.entries().map(|(_, entry)| entry.size).sum();
        serde_json::json!({
            "games": per_game,
            "totalEntries": self.len(),
            "totalBytes": total_bytes,
        })
    }
}

/// Entry and byte tally.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct Count {
    /// Number of entries.
    pub entries: usize,
    /// Sum of their reported sizes (0 where an owner does not report a size).
    pub bytes: u64,
}

impl Count {
    fn add(&mut self, size: u64) {
        self.entries += 1;
        self.bytes += size;
    }
}

/// A classified catalog over every mounted game: the searchable index of the merged asset set.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedIndex {
    /// Combined entry/byte total.
    pub total: Count,
    /// Per game.
    pub by_game: BTreeMap<String, Count>,
    /// Per asset kind (`Texture`, `Model`, `Audio`, ...).
    pub by_kind: BTreeMap<String, Count>,
    /// Per game, then per kind.
    pub by_game_kind: BTreeMap<String, BTreeMap<String, Count>>,
    /// The most common extensions, descending (top 40).
    pub top_extensions: Vec<(String, usize)>,
}

/// One search hit addressed by unified `<game>/<path>`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// Owning game label.
    pub game: String,
    /// Unified path (`<game>/<entry>`), ready for [`UnifiedVfs::read`].
    pub path: String,
    /// Asset kind.
    pub kind: String,
    /// Format id (extension or sniffed magic).
    pub format: String,
    /// Reported size.
    pub size: u64,
}

impl UnifiedVfs {
    /// Build the classified catalog across every game (no reads; uses listed metadata).
    #[must_use]
    pub fn index(&self) -> UnifiedIndex {
        let mut index = UnifiedIndex::default();
        let mut extensions: HashMap<String, usize> = HashMap::new();
        for (game, entry) in self.entries() {
            let kind = format!("{:?}", entry.kind);
            index.total.add(entry.size);
            index
                .by_game
                .entry(game.to_string())
                .or_default()
                .add(entry.size);
            index
                .by_kind
                .entry(kind.clone())
                .or_default()
                .add(entry.size);
            index
                .by_game_kind
                .entry(game.to_string())
                .or_default()
                .entry(kind)
                .or_default()
                .add(entry.size);
            let ext = Path::new(&entry.path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !ext.is_empty() {
                *extensions.entry(ext).or_default() += 1;
            }
        }
        let mut extensions: Vec<(String, usize)> = extensions.into_iter().collect();
        extensions.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        extensions.truncate(40);
        index.top_extensions = extensions;
        index
    }

    /// Entries whose unified path contains `query` (case-insensitive), capped at `limit`.
    #[must_use]
    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        let needle = query.to_ascii_lowercase();
        let mut hits = Vec::new();
        for (game, entry) in self.entries() {
            let unified = format!("{game}/{}", entry.path);
            if unified.to_ascii_lowercase().contains(&needle) {
                hits.push(Hit {
                    game: game.to_string(),
                    path: unified,
                    kind: format!("{:?}", entry.kind),
                    format: entry.format.clone(),
                    size: entry.size,
                });
                if hits.len() >= limit {
                    break;
                }
            }
        }
        hits
    }
}

/// First of `base`, `base2`, `base3`, ... not already present in `existing`.
fn unique_label(existing: &[&str], base: &str) -> String {
    if !existing.contains(&base) {
        return base.to_string();
    }
    (2..)
        .map(|n| format!("{base}{n}"))
        .find(|candidate| !existing.contains(&candidate.as_str()))
        .expect("the integer range is unbounded")
}
