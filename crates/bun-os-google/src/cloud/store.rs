//! Sealed files: AES-256-GCM at rest with a 32-byte key file created owner-only (0600) beside the state.
//!
//! Layout: `b"BOG1" || nonce(12) || ciphertext+tag`. The key never leaves the protected directory
//! (VPS: `/etc/aphrody/google`, root:ubuntu 0750); the sealed file and the key are written with mode 0600.

use super::{Error, Result};
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use std::path::{Path, PathBuf};

const MAGIC: &[u8; 4] = b"BOG1";

/// One sealed JSON document.
#[derive(Debug, Clone)]
pub struct SealedFile {
    path: PathBuf,
    key_path: PathBuf,
}

fn write_private(path: &Path, data: &[u8]) -> Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| Error::Store(format!("{}: {e}", dir.display())))?;
    }
    let tmp = path.with_extension("tmp");
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts
        .open(&tmp)
        .map_err(|e| Error::Store(format!("{}: {e}", tmp.display())))?;
    f.write_all(data)
        .and_then(|()| f.sync_all())
        .map_err(|e| Error::Store(format!("{}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, path).map_err(|e| Error::Store(format!("{}: {e}", path.display())))
}

impl SealedFile {
    /// `path` holds the sealed document, `key_path` the 32-byte key.
    pub fn new(path: impl Into<PathBuf>, key_path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            key_path: key_path.into(),
        }
    }
    /// Sealed document path.
    pub fn path(&self) -> &Path {
        &self.path
    }
    /// Whether a sealed document exists.
    pub fn exists(&self) -> bool {
        self.path.is_file()
    }
    fn cipher(&self, create: bool) -> Result<Aes256Gcm> {
        let key = match std::fs::read(&self.key_path) {
            Ok(k) if k.len() == 32 => k,
            Ok(_) => return Err(Error::Store("key file is not 32 bytes".into())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && create => {
                let mut k = vec![0u8; 32];
                getrandom::fill(&mut k).map_err(|e| Error::Store(format!("os randomness: {e}")))?;
                write_private(&self.key_path, &k)?;
                k
            }
            Err(e) => return Err(Error::Store(format!("{}: {e}", self.key_path.display()))),
        };
        Aes256Gcm::new_from_slice(&key).map_err(|_| Error::Store("bad key length".into()))
    }
    /// Encrypt and write `value`.
    pub fn save<T: serde::Serialize>(&self, value: &T) -> Result<()> {
        let plain = serde_json::to_vec(value).map_err(|e| Error::Store(e.to_string()))?;
        let cipher = self.cipher(true)?;
        let mut nonce = [0u8; 12];
        getrandom::fill(&mut nonce).map_err(|e| Error::Store(format!("os randomness: {e}")))?;
        let sealed = cipher
            .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
            .map_err(|_| Error::Store("encryption failed".into()))?;
        let mut out = Vec::with_capacity(4 + 12 + sealed.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        write_private(&self.path, &out)
    }
    /// Read and decrypt; `Ok(None)` when nothing is stored yet.
    pub fn load<T: serde::de::DeserializeOwned>(&self) -> Result<Option<T>> {
        let raw = match std::fs::read(&self.path) {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(Error::Store(format!("{}: {e}", self.path.display()))),
        };
        if raw.len() < 4 + 12 + 16 || &raw[..4] != MAGIC {
            return Err(Error::Store("not a sealed file".into()));
        }
        let cipher = self.cipher(false)?;
        let plain = cipher
            .decrypt(Nonce::from_slice(&raw[4..16]), &raw[16..])
            .map_err(|_| Error::Store("decryption failed (wrong key or corrupt file)".into()))?;
        serde_json::from_slice(&plain)
            .map(Some)
            .map_err(|e| Error::Store(e.to_string()))
    }
    /// Remove the sealed document (the key stays).
    pub fn clear(&self) -> Result<()> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::Store(e.to_string())),
        }
    }
}
