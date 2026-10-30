// SPDX-License-Identifier: Apache-2.0
//! Explicit references and age-bounded garbage collection. All cooperating
//! processes use the store lock; a malformed reference aborts before deletion.

use super::{BlobId, Store};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::time::{Duration, SystemTime};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GcReport {
    pub eligible_blobs: u64,
    pub eligible_bytes: u64,
    pub removed_blobs: u64,
    pub removed_bytes: u64,
}

fn valid_owner(owner: &str) -> io::Result<()> {
    if owner.is_empty()
        || owner.len() > 128
        || matches!(owner, "." | "..")
        || !owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid store reference owner",
        ));
    }
    Ok(())
}

impl Store {
    pub(super) fn lock(&self, exclusive: bool) -> io::Result<File> {
        fs::create_dir_all(&self.root)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.root.join("store.lock"))?;
        if exclusive {
            file.lock()?;
        } else {
            file.lock_shared()?;
        }
        Ok(file)
    }

    /// Ingest and register a reference in one GC-protected operation.
    /// Other caches must call this instead of assuming an unpinned blob is live.
    pub fn put_and_pin(
        &self,
        owner: &str,
        reader: impl Read,
        expected: Option<&BlobId>,
    ) -> io::Result<BlobId> {
        valid_owner(owner)?;
        let _guard = self.lock(false)?;
        let id = self.put_unlocked(reader, expected)?;
        self.pin_unlocked(owner, &id)?;
        Ok(id)
    }

    /// Add a durable owner reference after verifying the referenced content.
    pub fn pin(&self, owner: &str, id: &BlobId) -> io::Result<()> {
        valid_owner(owner)?;
        let _guard = self.lock(false)?;
        self.verify_unlocked(id)?;
        self.pin_unlocked(owner, id)
    }

    fn pin_unlocked(&self, owner: &str, id: &BlobId) -> io::Result<()> {
        let directory = self.root.join("refs").join(owner);
        fs::create_dir_all(&directory)?;
        let path = directory.join(id.as_str());
        match File::create_new(&path) {
            Ok(file) => file.sync_all(),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let metadata = fs::symlink_metadata(path)?;
                if metadata.is_file() && metadata.len() == 0 {
                    Ok(())
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid store reference",
                    ))
                }
            }
            Err(error) => Err(error),
        }
    }

    /// Remove only this owner's reference. Other owners remain independently pinned.
    pub fn unpin(&self, owner: &str, id: &BlobId) -> io::Result<bool> {
        valid_owner(owner)?;
        let _guard = self.lock(false)?;
        match fs::remove_file(self.root.join("refs").join(owner).join(id.as_str())) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn references(&self) -> io::Result<BTreeSet<BlobId>> {
        let mut live = BTreeSet::new();
        let owners = match fs::read_dir(self.root.join("refs")) {
            Ok(owners) => owners,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(live),
            Err(error) => return Err(error),
        };
        for owner in owners {
            let owner = owner?;
            let name = owner.file_name();
            valid_owner(
                name.to_str()
                    .ok_or_else(|| io::Error::other("non-UTF8 reference owner"))?,
            )?;
            if !owner.file_type()?.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid reference directory",
                ));
            }
            for reference in fs::read_dir(owner.path())? {
                let reference = reference?;
                let metadata = reference.metadata()?;
                if !reference.file_type()?.is_file() || metadata.len() != 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid reference marker",
                    ));
                }
                let name = reference.file_name();
                let name = name
                    .to_str()
                    .ok_or_else(|| io::Error::other("non-UTF8 reference"))?;
                let id = BlobId::parse(name)?;
                if id.as_str() != name {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "noncanonical reference",
                    ));
                }
                live.insert(id);
            }
        }
        Ok(live)
    }

    /// Collect only unreferenced blobs older than the requested grace period.
    /// `apply=false` is a dry run. Staging files are never collected: a producer
    /// might still own them. This does not prune ecosystem or protected stores.
    pub fn gc(&self, minimum_age: Duration, apply: bool) -> io::Result<GcReport> {
        let _guard = self.lock(true)?;
        let live = self.references()?;
        let now = SystemTime::now();
        let mut candidates = Vec::new();
        let shards = match fs::read_dir(self.root.join("blobs").join("sha256")) {
            Ok(shards) => shards,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(GcReport::default()),
            Err(error) => return Err(error),
        };
        // Build and validate the entire candidate list before the first deletion.
        for shard in shards {
            let shard = shard?;
            if !shard.file_type()?.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid blob shard",
                ));
            }
            for entry in fs::read_dir(shard.path())? {
                let entry = entry?;
                let name = entry.file_name();
                let id = BlobId::parse(
                    name.to_str()
                        .ok_or_else(|| io::Error::other("non-UTF8 blob"))?,
                )?;
                if entry.path() != self.blob_path(&id) || !entry.file_type()?.is_file() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid blob object",
                    ));
                }
                let metadata = entry.metadata()?;
                let age = now
                    .duration_since(metadata.modified()?)
                    .unwrap_or(Duration::ZERO);
                if !live.contains(&id) && age >= minimum_age {
                    candidates.push((entry.path(), metadata.len()));
                }
            }
        }
        let mut report = GcReport::default();
        for (_, bytes) in &candidates {
            report.eligible_blobs += 1;
            report.eligible_bytes = report
                .eligible_bytes
                .checked_add(*bytes)
                .ok_or_else(|| io::Error::other("GC size overflow"))?;
        }
        if apply {
            for (path, bytes) in candidates {
                fs::remove_file(path)?;
                report.removed_blobs += 1;
                report.removed_bytes += bytes;
            }
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gc_retains_each_owner_reference_and_dry_run_never_deletes() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let store = Store::new(root.path());
        let live = store.put_and_pin("nuget", &b"live"[..], None)?;
        store.pin("vcpkg", &live)?;
        let orphan = store.put(&b"orphan"[..], None)?;
        assert_eq!(store.gc(Duration::ZERO, false)?.eligible_blobs, 1);
        store.verify(&orphan)?;
        assert_eq!(store.gc(Duration::ZERO, true)?.removed_bytes, 6);
        store.unpin("nuget", &live)?;
        assert_eq!(store.gc(Duration::ZERO, true)?.removed_blobs, 0);
        store.unpin("vcpkg", &live)?;
        assert_eq!(store.gc(Duration::ZERO, true)?.removed_blobs, 1);
        assert_eq!(store.stats()?.blobs, 0);
        Ok(())
    }

    #[test]
    fn bad_references_abort_gc_and_future_grace_retains_orphans() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let store = Store::new(root.path());
        let id = store.put(&b"keep"[..], None)?;
        assert!(store.pin("../unsafe", &id).is_err());
        assert_eq!(store.gc(Duration::from_secs(3600), true)?.removed_blobs, 0);
        fs::create_dir_all(root.path().join("refs/broken"))?;
        fs::write(root.path().join("refs/broken/not-a-digest"), b"")?;
        assert!(store.gc(Duration::ZERO, true).is_err());
        store.verify(&id)?;
        Ok(())
    }
}
