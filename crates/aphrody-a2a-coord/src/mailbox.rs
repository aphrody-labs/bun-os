// SPDX-License-Identifier: Apache-2.0
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
};

use thiserror::Error;

use crate::envelope::Envelope;

#[derive(Debug, Error)]
pub enum MailboxError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct Mailbox {
    pub coord_dir: PathBuf,
}

impl Mailbox {
    #[must_use]
    pub fn new(coord_dir: PathBuf) -> Self {
        Self { coord_dir }
    }

    /// Create a mailbox rooted in one explicit Home Agent profile.
    #[must_use]
    pub fn for_profile_root(profile_root: &std::path::Path) -> Self {
        Self::new(profile_root.join(".coord"))
    }

    pub fn ensure_dir(&self) -> Result<(), MailboxError> {
        std::fs::create_dir_all(&self.coord_dir)?;
        Ok(())
    }

    pub fn inbox_path(&self, peer_short: &str) -> PathBuf {
        self.coord_dir
            .join(format!("inbox-from-{peer_short}.jsonl"))
    }

    pub fn append(&self, peer_short: &str, env: &Envelope) -> Result<(), MailboxError> {
        self.ensure_dir()?;
        let path = self.inbox_path(peer_short);
        let line = serde_json::to_string(env)?;
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        writeln!(file, "{line}")?;
        Ok(())
    }

    pub fn read_last(&self, peer_short: &str) -> Result<Option<Envelope>, MailboxError> {
        let path = self.inbox_path(peer_short);
        let mut file = match File::open(&path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let last = content.lines().rev().find(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with("//")
        });
        match last {
            Some(line) => Ok(Some(serde_json::from_str(line)?)),
            None => Ok(None),
        }
    }

    pub fn bump_heartbeat(&self, peer_short: &str) -> Result<(), MailboxError> {
        self.ensure_dir()?;
        let path = self.coord_dir.join(format!("heartbeat-{peer_short}.txt"));
        std::fs::write(path, chrono::Utc::now().to_rfc3339())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_mailboxes_are_disjoint() {
        let root = std::path::Path::new("/state");
        let left = root.join("workspace-worker");
        let right = root.join("workspace-niers");

        let left_mailbox = Mailbox::for_profile_root(&left);
        let right_mailbox = Mailbox::for_profile_root(&right);
        assert_ne!(left_mailbox.coord_dir, right_mailbox.coord_dir);
        assert_ne!(
            left_mailbox.inbox_path("peer"),
            right_mailbox.inbox_path("peer")
        );
        assert!(left_mailbox.inbox_path("peer").starts_with(&left));
        assert!(right_mailbox.inbox_path("peer").starts_with(&right));
    }
}
