//! Offline cache: file bytes keyed by item id and validated by the provider's version token.
//!
//! Layout under the cache directory: `index.json` (id -> version, name, file) and `blobs/<sha256(id)>`.
//! Reads work with no network via [`OfflineCache::get_cached`]; [`OfflineCache::open`] revalidates against the
//! remote version first and downloads only when it changed. [`OfflineCache::sync`] drains a change feed and
//! drops stale entries, returning the cursor to persist.

use crate::model::{Change, CloudFiles, Entry};
use aphrody_accounts::{Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Cached {
    version: Option<String>,
    name: String,
    blob: String,
    size: u64,
}

/// On-disk cache for one account.
pub struct OfflineCache {
    dir: PathBuf,
    index: BTreeMap<String, Cached>,
}

/// Result of [`OfflineCache::open`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Served from the cache (remote version unchanged).
    Cache,
    /// Downloaded because absent or stale.
    Network,
}

impl OfflineCache {
    /// Open or create the cache in `dir`.
    pub fn open_dir(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        std::fs::create_dir_all(dir.join("blobs"))?;
        let index = match std::fs::read(dir.join("index.json")) {
            Ok(b) => serde_json::from_slice(&b)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self { dir, index })
    }

    fn blob_name(id: &str) -> String {
        Sha256::digest(id.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
    }
    fn save_index(&self) -> Result<()> {
        let tmp = self.dir.join("index.json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.index)?)?;
        std::fs::rename(tmp, self.dir.join("index.json"))?;
        Ok(())
    }

    /// Store bytes for an entry (the version recorded is the entry's).
    pub fn put(&mut self, entry: &Entry, bytes: &[u8]) -> Result<()> {
        let blob = Self::blob_name(&entry.id);
        std::fs::write(self.dir.join("blobs").join(&blob), bytes)?;
        self.index.insert(entry.id.clone(), Cached { version: entry.version.clone(), name: entry.name.clone(), blob, size: bytes.len() as u64 });
        self.save_index()
    }
    /// Cached bytes regardless of freshness (offline mode).
    pub fn get_cached(&self, id: &str) -> Result<Option<Vec<u8>>> {
        match self.index.get(id) {
            Some(c) => Ok(Some(std::fs::read(self.dir.join("blobs").join(&c.blob))?)),
            None => Ok(None),
        }
    }
    /// Version recorded for an id.
    pub fn version_of(&self, id: &str) -> Option<&str> {
        self.index.get(id).and_then(|c| c.version.as_deref())
    }
    /// Drop one entry.
    pub fn invalidate(&mut self, id: &str) -> Result<()> {
        if let Some(c) = self.index.remove(id) {
            match std::fs::remove_file(self.dir.join("blobs").join(c.blob)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
            self.save_index()?;
        }
        Ok(())
    }
    /// Number of cached files and total bytes.
    pub fn stats(&self) -> (usize, u64) {
        (self.index.len(), self.index.values().map(|c| c.size).sum())
    }

    /// Fetch through the cache: one `stat`, then a download only when the version differs.
    pub fn open(&mut self, files: &dyn CloudFiles, id: &str) -> Result<(Vec<u8>, Source)> {
        let remote = files.stat(id)?;
        if remote.version.is_some() && self.version_of(id) == remote.version.as_deref() {
            if let Some(b) = self.get_cached(id)? {
                return Ok((b, Source::Cache));
            }
        }
        let bytes = files.download(id)?;
        self.put(&remote, &bytes)?;
        Ok((bytes, Source::Network))
    }

    /// Apply a page of changes: removals and modified versions drop the cached copy.
    pub fn apply(&mut self, changes: &[Change]) -> Result<usize> {
        let mut dropped = 0;
        for c in changes {
            let (id, stale) = match c {
                Change::Removed(id) => (id, true),
                Change::Upsert(e) => (&e.id, self.version_of(&e.id) != e.version.as_deref()),
            };
            if stale && self.index.contains_key(id) {
                self.invalidate(id)?;
                dropped += 1;
            }
        }
        Ok(dropped)
    }

    /// Drain the feed from `cursor` and return the cursor to store for next time.
    pub fn sync(&mut self, files: &dyn CloudFiles, cursor: &str) -> Result<String> {
        let mut at = cursor.to_owned();
        for _ in 0..10_000 {
            let page = files.changes(&at)?;
            self.apply(&page.changes)?;
            if let Some(next) = page.next_page {
                at = next;
            } else {
                return Ok(page.new_cursor.unwrap_or(at));
            }
        }
        Err(Error::Invalid("change feed did not terminate".into()))
    }

    /// Cache directory.
    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::testutil::api;
    use crate::drive::GoogleDrive;
    use aphrody_accounts::HttpResponse;
    use aphrody_accounts::testing::ScriptedTransport;
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn revalidates_by_version_and_downloads_only_when_stale() {
        let dir = tempfile::tempdir().unwrap();
        let t = Arc::new(
            ScriptedTransport::new()
                .on("/files/f?", HttpResponse::json(200, &json!({"id":"f","name":"n","version":"1"})))
                .on("alt=media", HttpResponse { status: 200, body: b"v1".to_vec(), ..Default::default() })
                .on("/files/f?", HttpResponse::json(200, &json!({"id":"f","name":"n","version":"1"})))
                .on("/files/f?", HttpResponse::json(200, &json!({"id":"f","name":"n","version":"2"})))
                .on("alt=media", HttpResponse { status: 200, body: b"v2".to_vec(), ..Default::default() }),
        );
        let d = GoogleDrive::new(api(t.clone()));
        let mut c = OfflineCache::open_dir(dir.path()).unwrap();
        assert_eq!(c.open(&d, "f").unwrap(), (b"v1".to_vec(), Source::Network));
        assert_eq!(c.open(&d, "f").unwrap(), (b"v1".to_vec(), Source::Cache));
        assert_eq!(c.open(&d, "f").unwrap(), (b"v2".to_vec(), Source::Network));
        assert_eq!(t.count("alt=media"), 2);
        // Reopened from disk, still usable with no network at all.
        let again = OfflineCache::open_dir(dir.path()).unwrap();
        assert_eq!(again.get_cached("f").unwrap().unwrap(), b"v2");
        assert_eq!(again.stats(), (1, 2));
    }

    #[test]
    fn change_feed_invalidates_modified_and_removed_entries() {
        let dir = tempfile::tempdir().unwrap();
        let t = Arc::new(
            ScriptedTransport::new()
                .on("/changes?pageToken=C0", HttpResponse::json(200, &json!({"nextPageToken":"C1","changes":[
                    {"fileId":"a","removed":true},
                    {"fileId":"b","file":{"id":"b","name":"b","version":"5"}}]})))
                .on("/changes?pageToken=C1", HttpResponse::json(200, &json!({"newStartPageToken":"C9","changes":[
                    {"fileId":"c","file":{"id":"c","name":"c","version":"1"}}]}))),
        );
        let d = GoogleDrive::new(api(t));
        let mut c = OfflineCache::open_dir(dir.path()).unwrap();
        let mk = |id: &str, v: &str| Entry {
            id: id.into(), name: id.into(), kind: crate::EntryKind::File, mime: None, size: None, modified: None,
            version: Some(v.into()), parents: vec![], web_url: None,
        };
        c.put(&mk("a", "1"), b"A").unwrap();
        c.put(&mk("b", "4"), b"B").unwrap();
        c.put(&mk("c", "1"), b"C").unwrap();
        assert_eq!(c.sync(&d, "C0").unwrap(), "C9");
        assert!(c.get_cached("a").unwrap().is_none(), "removed upstream");
        assert!(c.get_cached("b").unwrap().is_none(), "version 4 -> 5");
        assert!(c.get_cached("c").unwrap().is_some(), "unchanged version stays cached");
    }
}
