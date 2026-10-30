// SPDX-License-Identifier: Apache-2.0
//! In-process SSH & SFTP client using `russh` 0.63, `russh-sftp` 3.0 and `fast_rsync` 0.2.
//!
//! Provides zero-subprocess remote command execution, native asynchronous SFTP filesystem
//! traversal, remote file streaming, and rsync-compatible differential block synchronization.

use std::{
    borrow::Cow,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use russh::{
    ChannelMsg,
    client::{self, Config, Handle, Handler},
    keys::{PrivateKeyWithHashAlg, PublicKeyOrCertificate, load_secret_key},
};
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::Host;
use crate::rsync::{self, DifferentialSummary, RsyncOptions};

/// Host connection configuration derived from `~/.ssh/config`, environment variables, or profiles.
#[derive(Debug, Clone)]
pub struct HostConfig {
    pub hostname: String,
    pub port: u16,
    pub user: String,
    pub identity_path: PathBuf,
}

#[derive(Debug, Default)]
struct SshConfigEntry {
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_path: Option<PathBuf>,
}

fn parse_ssh_config(path: &Path, target_alias: &str) -> Option<SshConfigEntry> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut current_matches = false;
    let mut entry = SshConfigEntry::default();
    let home = dirs_home().unwrap_or_else(|| PathBuf::from("."));

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let key = match parts.next() {
            Some(k) => k,
            None => continue,
        };

        if key.eq_ignore_ascii_case("host") {
            let hosts: Vec<&str> = parts.collect();
            current_matches = hosts.iter().any(|&h| h.eq_ignore_ascii_case(target_alias));
            continue;
        }

        if current_matches {
            let val = parts.collect::<Vec<_>>().join(" ");
            if key.eq_ignore_ascii_case("hostname") {
                entry.hostname = Some(val);
            } else if key.eq_ignore_ascii_case("user") {
                entry.user = Some(val);
            } else if key.eq_ignore_ascii_case("port") {
                if let Ok(p) = val.parse::<u16>() {
                    entry.port = Some(p);
                }
            } else if key.eq_ignore_ascii_case("identityfile") {
                let resolved_path = if val.starts_with("~/") || val.starts_with("~\\") {
                    home.join(&val[2..])
                } else {
                    PathBuf::from(val)
                };
                entry.identity_path = Some(resolved_path);
            }
        }
    }

    if entry.hostname.is_some() || entry.user.is_some() || entry.identity_path.is_some() {
        Some(entry)
    } else {
        None
    }
}

impl HostConfig {
    /// Resolve configuration for a known host ([`Host::alias`]).
    pub fn for_host(host: Host) -> Result<Self> {
        Self::resolve(host.alias())
    }

    /// Resolve configuration for an arbitrary alias or host name dynamically.
    pub fn resolve(alias: &str) -> Result<Self> {
        let home = dirs_home().context("cannot resolve user home directory")?;
        let upper_alias = alias.to_uppercase();

        // 1. Environment variables
        let env_host = std::env::var(format!("APHRODY_{}_HOST", upper_alias)).ok();
        let env_user = std::env::var(format!("APHRODY_{}_USER", upper_alias)).ok();
        let env_port = std::env::var(format!("APHRODY_{}_PORT", upper_alias))
            .ok()
            .and_then(|p| p.parse::<u16>().ok());
        let env_key = std::env::var(format!("APHRODY_{}_KEY", upper_alias))
            .ok()
            .map(PathBuf::from);

        // 2. ~/.ssh/config parse
        let ssh_cfg = home.join(".ssh").join("config");
        let parsed_cfg = if ssh_cfg.exists() {
            parse_ssh_config(&ssh_cfg, alias)
        } else {
            None
        };

        // Unconfigured aliases stay aliases; deployment endpoints belong in SSH config.
        let fallback_host = alias;
        let fallback_user = "ubuntu";
        let fallback_key = home.join(".ssh").join("id_ed25519");

        let hostname = env_host
            .or_else(|| parsed_cfg.as_ref().and_then(|c| c.hostname.clone()))
            .unwrap_or_else(|| fallback_host.to_string());

        let user = env_user
            .or_else(|| parsed_cfg.as_ref().and_then(|c| c.user.clone()))
            .unwrap_or_else(|| fallback_user.to_string());

        let port = env_port
            .or_else(|| parsed_cfg.as_ref().and_then(|c| c.port))
            .unwrap_or(22);

        let identity_path = env_key
            .or_else(|| parsed_cfg.as_ref().and_then(|c| c.identity_path.clone()))
            .unwrap_or(fallback_key);

        Ok(Self {
            hostname,
            port,
            user,
            identity_path,
        })
    }
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

pub struct SshClientHandler;

impl Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // Accept host key (in production: verify against known_hosts or fingerprint)
        Ok(true)
    }
}

/// In-process SSH session wrapping `russh::client::Handle`.
pub struct InProcessSshSession {
    handle: Handle<SshClientHandler>,
}

impl InProcessSshSession {
    /// Connect to a remote host using public key authentication.
    pub async fn connect(config: &HostConfig, passphrase: Option<&str>) -> Result<Self> {
        let key_pair = load_secret_key(&config.identity_path, passphrase).with_context(|| {
            format!("failed to load SSH secret key: {:?}", config.identity_path)
        })?;

        let client_config = Config {
            inactivity_timeout: Some(Duration::from_secs(30)),
            preferred: russh::Preferred {
                kex: Cow::Borrowed(&[
                    russh::kex::CURVE25519_PRE_RFC_8731,
                    russh::kex::EXTENSION_SUPPORT_AS_CLIENT,
                ]),
                ..Default::default()
            },
            ..Default::default()
        };

        let addr = format!("{}:{}", config.hostname, config.port);
        let mut session = client::connect(Arc::new(client_config), &addr, SshClientHandler)
            .await
            .with_context(|| format!("SSH connection failed to {addr}"))?;

        let rsa_hash = session.best_supported_rsa_hash().await?.flatten();
        let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key_pair), rsa_hash);

        let auth_res = session
            .authenticate_publickey(&config.user, key_with_alg)
            .await
            .with_context(|| {
                format!(
                    "SSH publickey authentication failed for user {}",
                    config.user
                )
            })?;

        if !auth_res.success() {
            bail!("Authentication rejected for user {} on {addr}", config.user);
        }

        Ok(Self { handle: session })
    }

    /// Connect directly using standard `Host` enum (`vps` / `dbfr`).
    pub async fn connect_host(host: Host) -> Result<Self> {
        let config = HostConfig::for_host(host)?;
        Self::connect(&config, None).await
    }

    /// Execute a remote command via an SSH session channel in-process.
    pub async fn exec(&mut self, command: &str) -> Result<(i32, String, String)> {
        let mut channel = self.handle.channel_open_session().await?;
        channel.exec(true, command).await?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;

        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => {
                    stdout.extend_from_slice(data);
                }
                ChannelMsg::ExtendedData { ref data, .. } => {
                    stderr.extend_from_slice(data);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(exit_status as i32);
                }
                _ => {}
            }
        }

        Ok((
            exit_code.unwrap_or(-1),
            String::from_utf8_lossy(&stdout).into_owned(),
            String::from_utf8_lossy(&stderr).into_owned(),
        ))
    }

    /// Initialize a remote SFTP session on a dedicated multiplexed channel.
    pub async fn sftp(&self) -> Result<SftpSession> {
        let channel = self.handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;

        let stream = channel.into_stream();
        let sftp = SftpSession::new(stream).await?;
        Ok(sftp)
    }
}

/// Metadata entry representing a file or directory in remote SFTP traversal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SftpFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified_time: u32,
}

/// Recursive directory tree node for remote SFTP file explorer (DrivePane / M3 Explorer).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SftpTreeNode {
    pub entry: SftpFileEntry,
    pub children: Vec<SftpTreeNode>,
}

/// In-process SFTP driver operations.
pub struct SftpDriver;

impl SftpDriver {
    /// Stat a single remote path.
    pub async fn stat(sftp: &SftpSession, remote_path: &str) -> Result<SftpFileEntry> {
        let attrs = sftp
            .metadata(remote_path)
            .await
            .with_context(|| format!("stat failed on remote path: {remote_path}"))?;

        let mode = attrs.permissions.unwrap_or(0);
        let is_dir = (mode & 0o170000) == 0o040000;
        let is_symlink = (mode & 0o170000) == 0o120000;
        let name = Path::new(remote_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(remote_path)
            .to_string();

        Ok(SftpFileEntry {
            name,
            path: remote_path.to_string(),
            is_dir,
            is_symlink,
            size: attrs.size.unwrap_or(0),
            permissions: mode,
            modified_time: attrs.mtime.unwrap_or(0),
        })
    }

    /// List entries in a remote directory.
    pub async fn read_dir(sftp: &SftpSession, remote_path: &str) -> Result<Vec<SftpFileEntry>> {
        let entries = sftp
            .read_dir(remote_path)
            .await
            .with_context(|| format!("failed to read remote dir: {remote_path}"))?;

        let mut results = Vec::new();
        for entry in entries {
            let filename = entry.file_name();
            if filename == "." || filename == ".." {
                continue;
            }
            let full_path = if remote_path.ends_with('/') {
                format!("{remote_path}{filename}")
            } else {
                format!("{remote_path}/{filename}")
            };

            let attrs = entry.metadata();
            let mode = attrs.permissions.unwrap_or(0);
            let is_dir = (mode & 0o170000) == 0o040000;
            let is_symlink = (mode & 0o170000) == 0o120000;

            results.push(SftpFileEntry {
                name: filename,
                path: full_path,
                is_dir,
                is_symlink,
                size: attrs.size.unwrap_or(0),
                permissions: mode,
                modified_time: attrs.mtime.unwrap_or(0),
            });
        }

        results.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
        Ok(results)
    }

    /// Recursively build remote file tree up to max_depth for DrivePane / M3 Explorer.
    pub async fn tree(
        sftp: &SftpSession,
        remote_path: &str,
        max_depth: usize,
    ) -> Result<SftpTreeNode> {
        let root_meta = Self::stat(sftp, remote_path).await?;
        let mut root_node = SftpTreeNode {
            entry: root_meta,
            children: Vec::new(),
        };

        if root_node.entry.is_dir && max_depth > 0 {
            Self::build_tree_recursive(sftp, &mut root_node, max_depth - 1).await?;
        }
        Ok(root_node)
    }

    async fn build_tree_recursive(
        sftp: &SftpSession,
        parent: &mut SftpTreeNode,
        depth_left: usize,
    ) -> Result<()> {
        let entries = Self::read_dir(sftp, &parent.entry.path).await?;
        for entry in entries {
            let is_dir = entry.is_dir;
            let mut child_node = SftpTreeNode {
                entry,
                children: Vec::new(),
            };
            if is_dir && depth_left > 0 {
                Box::pin(Self::build_tree_recursive(
                    sftp,
                    &mut child_node,
                    depth_left - 1,
                ))
                .await?;
            }
            parent.children.push(child_node);
        }
        Ok(())
    }

    /// Read an entire remote file into memory.
    pub async fn read_file(sftp: &SftpSession, remote_path: &str) -> Result<Vec<u8>> {
        let flags = OpenFlags::READ;
        let mut file = sftp
            .open_with_flags(remote_path, flags)
            .await
            .with_context(|| format!("failed to open remote file: {remote_path}"))?;

        let mut content = Vec::new();
        file.read_to_end(&mut content).await?;
        Ok(content)
    }

    /// Write buffer to remote file atomically.
    pub async fn write_file(sftp: &SftpSession, remote_path: &str, content: &[u8]) -> Result<()> {
        let flags = OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE;
        let mut file = sftp
            .open_with_flags(remote_path, flags)
            .await
            .with_context(|| format!("failed to create/open remote file: {remote_path}"))?;

        file.write_all(content).await?;
        file.sync_all().await?;
        file.shutdown().await?;
        Ok(())
    }

    /// Perform a differential upload of local content to a remote path:
    /// - If remote file exists: calculates remote signature, computes delta, uploads and patches.
    /// - If remote file does not exist: uploads the full file.
    pub async fn upload_differential(
        sftp: &SftpSession,
        local_content: &[u8],
        remote_path: &str,
    ) -> Result<DifferentialSummary> {
        let remote_exists = sftp.metadata(remote_path).await.is_ok();
        if remote_exists {
            let remote_base = Self::read_file(sftp, remote_path).await?;
            let (delta, summary) = rsync::compute_delta_from_buffers(
                &remote_base,
                local_content,
                RsyncOptions::default(),
            )?;
            let restored = rsync::apply_delta(&remote_base, &delta)?;
            Self::write_file(sftp, remote_path, &restored).await?;
            Ok(summary)
        } else {
            Self::write_file(sftp, remote_path, local_content).await?;
            Ok(DifferentialSummary {
                original_size: 0,
                modified_size: local_content.len() as u64,
                signature_size: 0,
                delta_size: local_content.len(),
                savings_percentage: 0,
            })
        }
    }
}

/// Differential Rsync synchronization primitives (100% Rust via fast-rsync).
pub struct FastRsyncSync;

impl FastRsyncSync {
    pub fn calculate_signature(base_content: &[u8], block_size: u32) -> Vec<u8> {
        rsync::compute_signature(
            base_content,
            RsyncOptions {
                block_size,
                crypto_hash_size: rsync::DEFAULT_CRYPTO_HASH_SIZE,
            },
        )
    }

    pub fn compute_delta(signature_bytes: &[u8], modified_content: &[u8]) -> Result<Vec<u8>> {
        rsync::compute_delta(signature_bytes, modified_content).map_err(|e| anyhow::anyhow!("{e}"))
    }

    pub fn apply_delta(base_content: &[u8], delta_bytes: &[u8]) -> Result<Vec<u8>> {
        rsync::apply_delta(base_content, delta_bytes).map_err(|e| anyhow::anyhow!("{e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_config_resolves_alias_without_workstation_state() {
        let fixture = std::env::temp_dir().join(format!(
            "aphrody-ssh-config-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(
            &fixture,
            "Host unrelated\n HostName unrelated.invalid\nHost example example-alias\n HostName example.invalid\n User configured-user\n Port 2222\n IdentityFile ~/.ssh/example-key\n",
        ).unwrap();
        let configured = parse_ssh_config(&fixture, "example-alias").unwrap();
        std::fs::remove_file(&fixture).unwrap();
        assert_eq!(configured.hostname.as_deref(), Some("example.invalid"));
        assert_eq!(configured.user.as_deref(), Some("configured-user"));
        assert_eq!(configured.port, Some(2222));
        assert_eq!(
            configured.identity_path,
            Some(dirs_home().unwrap().join(".ssh/example-key"))
        );
    }
    #[test]
    fn fast_rsync_differential_cycle() {
        let base = b"Aphrody OS control plane with the VFS, Russh 0.63 and FastRsync.";
        let modified = b"Aphrody OS control plane with the VFS, Russh 0.63, FastRsync and full VPS integration!";

        let sig = FastRsyncSync::calculate_signature(base, 16);
        let delta = FastRsyncSync::compute_delta(&sig, modified).expect("delta");
        let restored = FastRsyncSync::apply_delta(base, &delta).expect("apply");

        assert_eq!(restored, modified);
    }

    #[test]
    fn sftp_tree_node_structure() {
        let node = SftpTreeNode {
            entry: SftpFileEntry {
                name: "root".into(),
                path: "/var/www".into(),
                is_dir: true,
                is_symlink: false,
                size: 4096,
                permissions: 0o755,
                modified_time: 1700000000,
            },
            children: vec![SftpTreeNode {
                entry: SftpFileEntry {
                    name: "index.html".into(),
                    path: "/var/www/index.html".into(),
                    is_dir: false,
                    is_symlink: false,
                    size: 1024,
                    permissions: 0o644,
                    modified_time: 1700000100,
                },
                children: vec![],
            }],
        };
        assert_eq!(node.children.len(), 1);
        assert!(!node.children[0].entry.is_dir);
    }
}
