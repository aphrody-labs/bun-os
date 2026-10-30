// SPDX-License-Identifier: Apache-2.0
//! One token source for every remote-control channel.
//!
//! Lookup order: the channel's environment variable, then
//! `<aphrody home>/private/<target>/<file>`, then `<aphrody home>/private/<file>`.
//! The aphrody home is `APHRODY_HOME` or `~/.aphrody` (outside any repository). Values are
//! never printed: [`Secret`]'s `Debug` is redacted and [`Secret::describe`] only names the
//! source.

use std::fmt;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};

/// A remote-control channel needing a credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// Bearer of the WebSocket remote desktop (`aphrody infra remote serve`).
    Remote,
    /// Bearer sent to a remote `aphrody-mcp http` (computer use over MCP).
    Mcp,
    /// RFB (VNC) password; derived from the remote token when not set.
    Vnc,
    /// Bearer of `aphrody shell serve`.
    Shell,
}

impl TokenKind {
    pub const ALL: [Self; 4] = [Self::Remote, Self::Mcp, Self::Vnc, Self::Shell];

    /// Environment variable consulted first.
    #[must_use]
    pub fn env(self) -> &'static str {
        match self {
            Self::Remote => "APHRODY_REMOTE_TOKEN",
            Self::Mcp => "APHRODY_REMOTE_MCP_TOKEN",
            Self::Vnc => "APHRODY_VNC_PASSWORD",
            Self::Shell => "APHRODY_OS_AUTH_TOKEN",
        }
    }

    /// File name under `<aphrody home>/private[/<target>]`.
    #[must_use]
    pub fn file_name(self) -> &'static str {
        match self {
            Self::Remote => "remote.token",
            Self::Mcp => "mcp.token",
            Self::Vnc => "vnc.password",
            Self::Shell => "shell.token",
        }
    }

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Remote => "remote",
            Self::Mcp => "mcp",
            Self::Vnc => "vnc",
            Self::Shell => "shell",
        }
    }

    /// Parse `remote` / `mcp` / `vnc` / `shell`.
    pub fn parse(s: &str) -> Result<Self> {
        Self::ALL
            .into_iter()
            .find(|k| k.as_str().eq_ignore_ascii_case(s))
            .with_context(|| format!("unknown token kind {s} (remote, mcp, vnc, shell)"))
    }
}

/// Where a [`Secret`] came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenSource {
    Env(&'static str),
    File(PathBuf),
    /// VNC password derived from the remote token of that source.
    Derived(Box<TokenSource>),
}

impl fmt::Display for TokenSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Env(name) => write!(f, "env {name}"),
            Self::File(path) => write!(f, "file {}", path.display()),
            Self::Derived(from) => write!(f, "derived from remote token ({from})"),
        }
    }
}

/// A credential value with its provenance; `Debug` never shows the value.
#[derive(Clone)]
pub struct Secret {
    value: String,
    pub source: TokenSource,
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Secret")
            .field("value", &"<redacted>")
            .field("source", &self.source)
            .finish()
    }
}

impl Secret {
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.value
    }

    /// Source only, safe for logs and status output.
    #[must_use]
    pub fn describe(&self) -> String {
        self.source.to_string()
    }
}

/// `<aphrody home>/private`.
#[must_use]
pub fn private_dir() -> PathBuf {
    aphrody_wireguard::driver::aphrody_home().join("private")
}

fn read_file(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let value = text.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn safe_target(target: &str) -> bool {
    !target.is_empty()
        && target
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        && !target.starts_with('.')
}

fn lookup_in(dir: &Path, kind: TokenKind, target: Option<&str>) -> Option<Secret> {
    if let Some(v) = std::env::var(kind.env())
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        return Some(Secret {
            value: v.trim().to_owned(),
            source: TokenSource::Env(kind.env()),
        });
    }
    let mut candidates = Vec::new();
    if let Some(t) = target.filter(|t| safe_target(t)) {
        candidates.push(dir.join(t).join(kind.file_name()));
    }
    candidates.push(dir.join(kind.file_name()));
    candidates.into_iter().find_map(|p| {
        read_file(&p).map(|value| Secret {
            value,
            source: TokenSource::File(p),
        })
    })
}

fn resolve_in(dir: &Path, kind: TokenKind, target: Option<&str>) -> Option<Secret> {
    if let Some(s) = lookup_in(dir, kind, target) {
        return Some(s);
    }
    if kind == TokenKind::Vnc {
        let remote = lookup_in(dir, TokenKind::Remote, target)?;
        return Some(Secret {
            value: derive_vnc_password(remote.expose()),
            source: TokenSource::Derived(Box::new(remote.source)),
        });
    }
    None
}

/// Credential of `kind` for `target` (an inventory id such as `omar`, or none).
#[must_use]
pub fn resolve(kind: TokenKind, target: Option<&str>) -> Option<Secret> {
    resolve_in(&private_dir(), kind, target)
}

/// Env then state file only: never derives a value.
pub fn lookup(kind: TokenKind, target: Option<&str>) -> Option<Secret> {
    lookup_in(&private_dir(), kind, target)
}

/// Like [`resolve`] but an error naming every place that was searched.
pub fn require(kind: TokenKind, target: Option<&str>) -> Result<Secret> {
    resolve(kind, target).with_context(|| {
        let dir = private_dir();
        let scoped = target
            .filter(|t| safe_target(t))
            .map(|t| format!("{}, ", dir.join(t).join(kind.file_name()).display()))
            .unwrap_or_default();
        format!(
            "no {} credential: set {} or write {scoped}{}",
            kind.as_str(),
            kind.env(),
            dir.join(kind.file_name()).display()
        )
    })
}

/// VNC (RFB DES) password derived from the remote-desktop token: 8 hex characters of
/// `SHA-256("aphrody-vnc\0" || token)`. RFB authentication only uses 8 characters.
#[must_use]
pub fn derive_vnc_password(remote_token: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut h = Sha256::new();
    h.update(b"aphrody-vnc\0");
    h.update(remote_token.as_bytes());
    h.finalize()
        .iter()
        .take(8)
        .map(|b| char::from(ALPHABET[usize::from(b & 63)]))
        .collect()
}

/// Write a credential to `<aphrody home>/private[/<target>]/<file>` (owner-only on Unix).
pub fn store(kind: TokenKind, target: Option<&str>, value: &str) -> Result<PathBuf> {
    store_in(&private_dir(), kind, target, value)
}

fn store_in(dir: &Path, kind: TokenKind, target: Option<&str>, value: &str) -> Result<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        bail!("refusing to store an empty {} credential", kind.as_str());
    }
    let dir = match target {
        Some(t) if !safe_target(t) => bail!("invalid target name {t}"),
        Some(t) => dir.join(t),
        None => dir.to_path_buf(),
    };
    std::fs::create_dir_all(&dir).with_context(|| format!("cannot create {}", dir.display()))?;
    let path = dir.join(kind.file_name());
    write_private(&path, value).with_context(|| format!("cannot write {}", path.display()))?;
    Ok(path)
}

#[cfg(unix)]
fn write_private(path: &Path, value: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(value.as_bytes())?;
    f.write_all(b"\n")
}

#[cfg(not(unix))]
fn write_private(path: &Path, value: &str) -> std::io::Result<()> {
    // The profile directory ACL already restricts the aphrody home to its owner.
    std::fs::write(path, format!("{value}\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_password_is_stable_and_short() {
        let a = derive_vnc_password("abc");
        assert_eq!(a.len(), 8);
        assert_eq!(a, derive_vnc_password("abc"));
        assert_ne!(a, derive_vnc_password("abd"));
    }

    #[test]
    fn scoped_file_wins_over_global_and_vnc_derives() {
        // Environment variables are process-global: only exercise kinds whose variable is unset.
        if std::env::var_os(TokenKind::Remote.env()).is_some()
            || std::env::var_os(TokenKind::Vnc.env()).is_some()
        {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(resolve_in(dir.path(), TokenKind::Remote, Some("omar")).is_none());
        store_in(dir.path(), TokenKind::Remote, None, "global").unwrap();
        store_in(dir.path(), TokenKind::Remote, Some("omar"), "scoped").unwrap();
        let s = resolve_in(dir.path(), TokenKind::Remote, Some("omar")).unwrap();
        assert_eq!(s.expose(), "scoped");
        assert_eq!(
            resolve_in(dir.path(), TokenKind::Remote, Some("ie"))
                .unwrap()
                .expose(),
            "global"
        );
        let vnc = resolve_in(dir.path(), TokenKind::Vnc, Some("omar")).unwrap();
        assert_eq!(vnc.expose(), derive_vnc_password("scoped"));
        assert!(matches!(vnc.source, TokenSource::Derived(_)));
        assert!(!format!("{vnc:?}").contains(vnc.expose()));
        assert!(store_in(dir.path(), TokenKind::Remote, Some("../x"), "v").is_err());
        assert!(store_in(dir.path(), TokenKind::Remote, None, "  ").is_err());
    }

    #[test]
    fn kinds_parse() {
        for k in TokenKind::ALL {
            assert_eq!(TokenKind::parse(k.as_str()).unwrap(), k);
        }
        assert!(TokenKind::parse("nope").is_err());
    }
}
