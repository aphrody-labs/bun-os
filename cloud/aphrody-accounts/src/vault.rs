//! Where tokens live. Account metadata (labels, scopes) is not secret and lives in a JSON index;
//! the token material goes through a [`TokenVault`].

use crate::error::{Error, Result};
use std::collections::HashMap;
use std::sync::Mutex;

/// Secret storage keyed by account id.
pub trait TokenVault: Send + Sync {
    /// Read the serialized secret blob of an account.
    fn get(&self, key: &str) -> Result<Option<String>>;
    /// Create or replace it.
    fn set(&self, key: &str, value: &str) -> Result<()>;
    /// Remove it (missing key is not an error).
    fn delete(&self, key: &str) -> Result<()>;
    /// Short name for diagnostics.
    fn name(&self) -> &'static str;
}

/// Process-local vault (tests, ephemeral sessions).
#[derive(Default)]
pub struct MemoryVault {
    map: Mutex<HashMap<String, String>>,
}

impl MemoryVault {
    /// Empty vault.
    pub fn new() -> Self {
        Self::default()
    }
}

impl TokenVault for MemoryVault {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.map.lock().map_err(|_| Error::Vault("poisoned".into()))?.get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        self.map.lock().map_err(|_| Error::Vault("poisoned".into()))?.insert(key.into(), value.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.map.lock().map_err(|_| Error::Vault("poisoned".into()))?.remove(key);
        Ok(())
    }
    fn name(&self) -> &'static str {
        "memory"
    }
}

/// OS credential store: Windows Credential Manager, macOS Keychain, Linux kernel keyutils.
///
/// Windows limits one credential blob to 2560 bytes (`CRED_MAX_CREDENTIAL_BLOB_SIZE`); Entra
/// refresh tokens plus id_token can exceed it, so values are split over `key#0`, `key#1`, ...
/// chunks of 1200 bytes with a `key#n` counter.
#[cfg(feature = "os-keyring")]
pub struct KeyringVault {
    service: String,
}

#[cfg(feature = "os-keyring")]
const CHUNK: usize = 1200;

#[cfg(feature = "os-keyring")]
impl KeyringVault {
    /// Vault under a keyring service name (default `aphrody-accounts`).
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }
    fn entry(&self, key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, key).map_err(|e| Error::Vault(e.to_string()))
    }
    fn read(&self, key: &str) -> Result<Option<String>> {
        match self.entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Vault(e.to_string())),
        }
    }
    fn remove(&self, key: &str) -> Result<()> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Vault(e.to_string())),
        }
    }
}

#[cfg(feature = "os-keyring")]
impl TokenVault for KeyringVault {
    fn get(&self, key: &str) -> Result<Option<String>> {
        let Some(n) = self.read(&format!("{key}#n"))? else { return Ok(None) };
        let n: usize = n.parse().map_err(|_| Error::Vault("corrupt chunk counter".into()))?;
        let mut out = String::new();
        for i in 0..n {
            out.push_str(&self.read(&format!("{key}#{i}"))?.ok_or_else(|| Error::Vault("missing chunk".into()))?);
        }
        Ok(Some(out))
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        self.delete(key)?;
        let chunks: Vec<&str> = split_utf8(value, CHUNK);
        for (i, c) in chunks.iter().enumerate() {
            self.entry(&format!("{key}#{i}"))?.set_password(c).map_err(|e| Error::Vault(e.to_string()))?;
        }
        self.entry(&format!("{key}#n"))?.set_password(&chunks.len().to_string()).map_err(|e| Error::Vault(e.to_string()))
    }
    fn delete(&self, key: &str) -> Result<()> {
        if let Some(n) = self.read(&format!("{key}#n"))?.and_then(|n| n.parse::<usize>().ok()) {
            for i in 0..n {
                self.remove(&format!("{key}#{i}"))?;
            }
        }
        self.remove(&format!("{key}#n"))
    }
    fn name(&self) -> &'static str {
        "os-keyring"
    }
}

/// Split on char boundaries into pieces of at most `max` bytes.
pub fn split_utf8(s: &str, max: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = s;
    while !rest.is_empty() {
        let mut end = max.min(rest.len());
        while !rest.is_char_boundary(end) {
            end -= 1;
        }
        let (head, tail) = rest.split_at(end);
        out.push(head);
        rest = tail;
    }
    if out.is_empty() {
        out.push("");
    }
    out
}

/// Adapter over an `aphrody-secrets` store (for example `EncryptedFileSecretStore`, AES-256-GCM +
/// Argon2id) for headless hosts without a keyring daemon. Blocks on a private current-thread runtime.
#[cfg(feature = "secrets")]
pub struct SecretStoreVault {
    store: std::sync::Arc<dyn aphrody_secrets::SecretStore>,
    rt: tokio::runtime::Runtime,
}

#[cfg(feature = "secrets")]
impl SecretStoreVault {
    /// Wrap a store.
    pub fn new(store: std::sync::Arc<dyn aphrody_secrets::SecretStore>) -> Result<Self> {
        let rt = tokio::runtime::Builder::new_current_thread().build()?;
        Ok(Self { store, rt })
    }
}

#[cfg(feature = "secrets")]
impl TokenVault for SecretStoreVault {
    fn get(&self, key: &str) -> Result<Option<String>> {
        let v = self.rt.block_on(self.store.get(key)).map_err(|e| Error::Vault(e.to_string()))?;
        Ok(v.map(|s| s.expose_secret().to_owned()))
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        let v = aphrody_secrets::SecretValue::from_string(value.to_owned());
        self.rt.block_on(self.store.set(key, v)).map_err(|e| Error::Vault(e.to_string()))
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.rt.block_on(self.store.delete(key)).map_err(|e| Error::Vault(e.to_string()))
    }
    fn name(&self) -> &'static str {
        "aphrody-secrets"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_vault_roundtrip() {
        let v = MemoryVault::new();
        assert_eq!(v.get("a").unwrap(), None);
        v.set("a", "1").unwrap();
        assert_eq!(v.get("a").unwrap().as_deref(), Some("1"));
        v.delete("a").unwrap();
        v.delete("a").unwrap();
        assert_eq!(v.get("a").unwrap(), None);
    }

    #[test]
    fn split_respects_char_boundaries() {
        let s = "aé".repeat(1000);
        let parts = split_utf8(&s, 7);
        assert!(parts.iter().all(|p| p.len() <= 7));
        assert_eq!(parts.concat(), s);
        assert_eq!(split_utf8("", 5), vec![""]);
    }
}
