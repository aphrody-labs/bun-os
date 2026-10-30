//! Project format shared by the craft apps, and cross-app handoff files.

use crate::asset::{AssetId, AssetMeta};
use crate::graph::EditStack;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const VERSION: u32 = 1;

/// One edited item (an image, or a frame range of a clip).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub asset: AssetId,
    pub stack: EditStack,
    /// Inclusive frame range for video assets.
    pub frames: Option<(u64, u64)>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub version: u32,
    pub name: String,
    /// Asset id -> metadata and the path of the original (library location).
    pub assets: BTreeMap<AssetId, (AssetMeta, PathBuf)>,
    pub items: Vec<Item>,
}

impl Project {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            version: VERSION,
            name: name.into(),
            assets: BTreeMap::new(),
            items: Vec::new(),
        }
    }

    pub fn add_asset(&mut self, meta: AssetMeta, path: PathBuf) {
        self.assets.insert(meta.id.clone(), (meta, path));
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn load(path: &Path) -> Result<Self> {
        let p: Self = serde_json::from_slice(&std::fs::read(path)?)?;
        if p.version != VERSION {
            return Err(Error::Version(p.version));
        }
        Ok(p)
    }
}

/// A message from one app to another ("open this asset with this edit stack in photocraft",
/// "send frames 120..=240 to effectcraft"). Stored as `<dir>/<to>/<nanos>-<from>.json`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Handoff {
    pub from: String,
    pub to: String,
    pub asset: AssetMeta,
    pub path: PathBuf,
    pub stack: EditStack,
    pub frames: Option<(u64, u64)>,
}

impl Handoff {
    /// Write into the inbox of `self.to`; returns the file path.
    pub fn send(&self, dir: &Path) -> Result<PathBuf> {
        let inbox = dir.join(&self.to);
        std::fs::create_dir_all(&inbox)?;
        let seq = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = inbox.join(format!("{seq:039}-{}.json", self.from));
        let tmp = p.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec(self)?)?;
        std::fs::rename(&tmp, &p)?;
        Ok(p)
    }

    /// Take the oldest pending handoff for `app` (removes the file).
    pub fn receive(dir: &Path, app: &str) -> Result<Option<Self>> {
        let Ok(rd) = std::fs::read_dir(dir.join(app)) else {
            return Ok(None);
        };
        let mut files: Vec<PathBuf> = rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "json"))
            .collect();
        files.sort();
        let Some(first) = files.first() else {
            return Ok(None);
        };
        let h: Self = serde_json::from_slice(&std::fs::read(first)?)?;
        std::fs::remove_file(first)?;
        Ok(Some(h))
    }
}
