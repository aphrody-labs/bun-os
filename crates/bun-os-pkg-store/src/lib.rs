// Leaf crate on std, outside the event loop (like `bun_host`): std I/O and strings are intended.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

// SPDX-License-Identifier: Apache-2.0
//! Shared SHA-256 blob store. Hosts supply streams; this crate never fetches.
//! Cache formats remain ecosystem-owned. Writable extraction must use copies:
//! hardlinking a mutable package tree would corrupt the shared content address.

#![forbid(unsafe_code)]

mod maintenance;
pub use maintenance::GcReport;

use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

/// Validated lowercase SHA-256 content address, safe as a path component.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct BlobId(String);

impl BlobId {
    pub fn parse(value: &str) -> io::Result<Self> {
        let value = value.strip_prefix("sha256:").unwrap_or(value);
        if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid SHA-256 address"));
        }
        Ok(Self(value.to_ascii_lowercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub struct Store {
    root: PathBuf,
}

/// Logical blob size. Filesystem compression/dedup/reflinks are not measured.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StoreStats {
    pub blobs: u64,
    pub bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Materialization {
    Reflink,
    Copy,
}

impl Store {
    /// Callers resolve the configured Aphrody home and pass `<home>/store`.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn blob_path(&self, id: &BlobId) -> PathBuf {
        self.root.join("blobs").join("sha256").join(&id.0[..2]).join(&id.0)
    }

    /// Count recognized regular blob files; never follows directory/file symlinks.
    /// Missing stores are empty; malformed objects are errors rather than hidden.
    pub fn stats(&self) -> io::Result<StoreStats> {
        let _guard = self.lock(false)?;
        let mut result = StoreStats::default();
        let directory = self.root.join("blobs").join("sha256");
        let shards = match fs::read_dir(directory) {
            Ok(shards) => shards,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(result),
            Err(error) => return Err(error),
        };
        for shard in shards {
            let shard = shard?;
            if !shard.file_type()?.is_dir() {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid blob shard"));
            }
            for entry in fs::read_dir(shard.path())? {
                let entry = entry?;
                let name = entry.file_name();
                let id = BlobId::parse(name.to_str().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "non-UTF8 blob name")
                })?)?;
                if entry.path() != self.blob_path(&id) || !entry.file_type()?.is_file() {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid blob object"));
                }
                result.blobs = result
                    .blobs
                    .checked_add(1)
                    .ok_or_else(|| io::Error::other("blob count overflow"))?;
                result.bytes = result
                    .bytes
                    .checked_add(entry.metadata()?.len())
                    .ok_or_else(|| io::Error::other("blob size overflow"))?;
            }
        }
        Ok(result)
    }

    /// Stream to a temporary file and publish without overwriting another writer.
    /// A declared upstream digest must match before any object is published.
    pub fn put(&self, mut reader: impl Read, expected: Option<&BlobId>) -> io::Result<BlobId> {
        let _guard = self.lock(false)?;
        self.put_unlocked(&mut reader, expected)
    }

    fn put_unlocked(&self, mut reader: impl Read, expected: Option<&BlobId>) -> io::Result<BlobId> {
        let staging = self.root.join("staging");
        fs::create_dir_all(&staging)?;
        let mut temporary = NamedTempFile::new_in(&staging)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            temporary.write_all(&buffer[..count])?;
        }
        let id = BlobId(hex::encode(hasher.finalize()));
        if expected.is_some_and(|expected| expected != &id) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "package digest mismatch"));
        }
        temporary.as_file().sync_all()?;
        let destination = self.blob_path(&id);
        let parent = destination.parent().ok_or_else(|| io::Error::other("missing blob parent"))?;
        fs::create_dir_all(parent)?;
        match temporary.persist_noclobber(&destination) {
            Ok(_) => {},
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                self.verify_unlocked(&id)?;
            },
            Err(error) => return Err(error.error),
        }
        Ok(id)
    }

    /// Recheck bytes before consuming an object; existence alone is insufficient.
    pub fn verify(&self, id: &BlobId) -> io::Result<()> {
        let _guard = self.lock(false)?;
        self.verify_unlocked(id)
    }

    fn verify_unlocked(&self, id: &BlobId) -> io::Result<()> {
        let mut file = File::open(self.blob_path(id))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        if hex::encode(hasher.finalize()) != id.0 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "corrupt package blob"));
        }
        Ok(())
    }

    /// Materialize independent writable bytes. Never clobbers an existing path.
    pub fn materialize(&self, id: &BlobId, destination: &Path) -> io::Result<()> {
        self.materialize_with_method(id, destination).map(|_| ())
    }

    /// Native block clone, then independent copy. Original-blob hardlinks are
    /// excluded for writable consumers. Returns the method actually used.
    pub fn materialize_with_method(
        &self,
        id: &BlobId,
        destination: &Path,
    ) -> io::Result<Materialization> {
        let _guard = self.lock(false)?;
        let parent =
            destination.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let staging = tempfile::tempdir_in(parent)?;
        let cloned_path = staging.path().join("blob");
        if reflink_copy::reflink(self.blob_path(id), &cloned_path).is_ok() {
            let mut cloned = File::open(&cloned_path)?;
            let mut hasher = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = cloned.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                hasher.update(&buffer[..count]);
            }
            if hex::encode(hasher.finalize()) != id.0 {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "corrupt cloned blob"));
            }
            drop(cloned);
            File::options().write(true).open(&cloned_path)?.sync_all()?;
            // Publish the independently cloned inode, not the store's inode.
            fs::hard_link(&cloned_path, destination)?;
            return Ok(Materialization::Reflink);
        }
        let mut temporary = NamedTempFile::new_in(parent)?;
        let mut source = File::open(self.blob_path(id))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = source.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            temporary.write_all(&buffer[..count])?;
        }
        if hex::encode(hasher.finalize()) != id.0 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "corrupt package blob"));
        }
        temporary.as_file().sync_all()?;
        temporary.persist_noclobber(destination).map_err(|error| error.error)?;
        Ok(Materialization::Copy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_content_has_one_address_and_mutable_copies_are_isolated() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let store = Store::new(root.path());
        let first = store.put(&b"package bytes"[..], None)?;
        let second = store.put(&b"package bytes"[..], Some(&first))?;
        assert_eq!(first, second);
        assert_eq!(store.stats()?, StoreStats { blobs: 1, bytes: 13 });
        let destination = root.path().join("consumer/package");
        let method = store.materialize_with_method(&first, &destination)?;
        eprintln!("materialization method: {method:?}");
        fs::write(&destination, b"consumer edits")?;
        store.verify(&first)?;
        assert_eq!(fs::read(store.blob_path(&first))?, b"package bytes");
        assert_eq!(
            store.materialize(&first, &destination).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        Ok(())
    }

    #[test]
    fn integrity_failures_do_not_publish_objects_or_consumers() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let store = Store::new(root.path());
        let id = store.put(&b"valid"[..], None)?;
        assert_eq!(
            store.put(&b"invalid"[..], Some(&id)).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        fs::write(store.blob_path(&id), b"corrupt")?;
        assert_eq!(store.verify(&id).unwrap_err().kind(), io::ErrorKind::InvalidData);
        let destination = root.path().join("consumer");
        assert_eq!(
            store.materialize(&id, &destination).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert!(!destination.exists());
        Ok(())
    }

    #[test]
    fn address_rejects_path_traversal_and_normalizes_hashes() -> io::Result<()> {
        assert!(BlobId::parse("../other").is_err());
        let uppercase = "A".repeat(64);
        assert_eq!(BlobId::parse(&format!("sha256:{uppercase}"))?.as_str(), "a".repeat(64));
        Ok(())
    }

    #[test]
    fn concurrent_ingestion_deduplicates_and_releases_temporaries() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let store = std::sync::Arc::new(Store::new(root.path()));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let store = std::sync::Arc::clone(&store);
                std::thread::spawn(move || store.put(&b"same package"[..], None))
            })
            .collect();
        let ids: Vec<_> = handles
            .into_iter()
            .map(|handle| {
                handle.join().map_err(|_| io::Error::other("ingestion worker panicked"))?
            })
            .collect::<io::Result<_>>()?;
        assert!(ids.iter().all(|id| id == &ids[0]));
        assert_eq!(store.stats()?, StoreStats { blobs: 1, bytes: 12 });
        assert_eq!(fs::read_dir(root.path().join("staging"))?.count(), 0);
        Ok(())
    }
}
