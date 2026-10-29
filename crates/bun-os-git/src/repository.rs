// SPDX-License-Identifier: Apache-2.0
//! Pure-Rust local repository inspection and GitHub remote normalization.

use std::{
    path::{Path, PathBuf},
    str::FromStr,
};

use serde::{Deserialize, Serialize};

use crate::{Error, git_error};

/// A normalized `owner/repository` GitHub identifier.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GitHubRepository {
    /// GitHub organization or user.
    pub owner: String,
    /// Repository name without a `.git` suffix.
    pub name: String,
}

impl GitHubRepository {
    /// Parse either `owner/name` or a GitHub HTTPS/SSH remote URL.
    pub fn parse(value: &str) -> Result<Self, Error> {
        Self::parse_with_host(value, "github.com")
    }

    /// Parse a repository reference for a configured GitHub or Enterprise host.
    pub fn parse_with_host(value: &str, github_host: &str) -> Result<Self, Error> {
        let value = value.trim().trim_end_matches('/');
        let scp_prefix = format!("git@{github_host}:");
        let path = if let Some(rest) = value.strip_prefix(&scp_prefix) {
            rest.to_owned()
        } else if value.matches('/').count() == 1 && !value.contains(':') {
            value.to_owned()
        } else {
            let url =
                url::Url::parse(value).map_err(|_| Error::InvalidRepository(value.to_owned()))?;
            if url.host_str() != Some(github_host)
                || !matches!(url.scheme(), "https" | "http" | "ssh")
            {
                return Err(Error::InvalidRepository(value.to_owned()));
            }
            url.path().trim_start_matches('/').to_owned()
        };

        let path = path.trim_end_matches(".git").trim_matches('/');
        let mut parts = path.split('/');
        let owner = parts.next().filter(|part| !part.is_empty());
        let name = parts.next().filter(|part| !part.is_empty());
        if parts.next().is_some()
            || owner.is_none()
            || name.is_none()
            || !valid_owner(owner.expect("checked above"))
            || !valid_repository_name(name.expect("checked above"))
        {
            return Err(Error::InvalidRepository(value.to_owned()));
        }
        Ok(Self {
            owner: owner.expect("checked above").to_owned(),
            name: name.expect("checked above").to_owned(),
        })
    }

    /// Return the canonical `owner/name` form.
    #[must_use]
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

fn valid_owner(owner: &str) -> bool {
    !owner.is_empty()
        && owner.len() <= 39
        && !owner.starts_with('-')
        && !owner.ends_with('-')
        && owner
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn valid_repository_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name != "."
        && name != ".."
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
}

impl std::fmt::Display for GitHubRepository {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}/{}", self.owner, self.name)
    }
}

impl FromStr for GitHubRepository {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

/// A configured Git remote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Remote {
    /// Symbolic remote name, usually `origin`.
    pub name: String,
    /// Fetch URL.
    pub fetch_url: Option<String>,
    /// Push URL.
    pub push_url: Option<String>,
    /// Parsed GitHub repository when either URL targets github.com.
    pub github: Option<GitHubRepository>,
}

/// One worktree or index change reported by `gix`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Change {
    /// Repository-relative path.
    pub path: String,
    /// Exact repository-relative path bytes, encoded as base64 for Unix fidelity.
    pub path_bytes_base64: String,
    /// `worktree` for index/worktree changes or `index` for HEAD/index changes.
    pub layer: String,
}

/// Serializable snapshot of a local repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalRepository {
    /// Canonical worktree root, or the Git directory for a bare repository.
    pub root: PathBuf,
    /// Git directory containing refs and object storage.
    pub git_dir: PathBuf,
    /// Short branch name, or `None` for detached HEAD.
    pub branch: Option<String>,
    /// Current commit object id, or `None` for an unborn repository.
    pub head: Option<String>,
    /// Whether the index/worktree contains tracked or untracked changes.
    pub dirty: bool,
    /// Native status entries.
    pub changes: Vec<Change>,
    /// Configured remotes.
    pub remotes: Vec<Remote>,
    /// First GitHub remote, preferring `origin`.
    pub github: Option<GitHubRepository>,
}

/// Discover and inspect the repository containing `path` without shelling out.
pub fn inspect_repository(path: impl AsRef<Path>) -> Result<LocalRepository, Error> {
    let requested = path.as_ref();
    let discovery_path = if requested.is_file() {
        requested.parent().unwrap_or(requested)
    } else {
        requested
    };
    let repository = gix::discover(discovery_path).map_err(git_error)?;
    let unresolved_root = repository.workdir().unwrap_or_else(|| repository.path());
    let root = std::fs::canonicalize(unresolved_root)
        .map_err(|error| crate::io_error("canonicalize repository root", unresolved_root, error))?;
    let unresolved_git_dir = repository.path();
    let git_dir = std::fs::canonicalize(unresolved_git_dir).map_err(|error| {
        crate::io_error("canonicalize Git directory", unresolved_git_dir, error)
    })?;
    let head_ref = repository.head().map_err(git_error)?;
    let branch = head_ref
        .referent_name()
        .map(|name| short_ref_name(&name.to_string()));
    let head = if head_ref.is_unborn() {
        None
    } else {
        Some(
            repository
                .head_commit()
                .map_err(git_error)?
                .id
                .to_hex()
                .to_string(),
        )
    };

    let mut changes = Vec::new();
    if repository.workdir().is_some() {
        let status = repository
            .status(gix::progress::Discard)
            .map_err(git_error)?
            .untracked_files(gix::status::UntrackedFiles::Files)
            .into_iter(Vec::<gix::bstr::BString>::new())
            .map_err(git_error)?;
        for item in status {
            let item = item.map_err(git_error)?;
            let layer = match item {
                gix::status::Item::IndexWorktree(_) => "worktree",
                gix::status::Item::TreeIndex(_) => "index",
            }
            .to_owned();
            let location = item.location();
            let path_bytes_base64 = {
                use base64::Engine as _;
                let bytes: &[u8] = location.as_ref();
                base64::engine::general_purpose::STANDARD.encode(bytes)
            };
            changes.push(Change {
                path: location.to_string(),
                path_bytes_base64,
                layer,
            });
        }
    }

    let mut remotes = Vec::new();
    let github_host = configured_github_host();
    for name in repository.remote_names() {
        let remote = repository
            .find_remote(AsRef::<gix::bstr::BStr>::as_ref(&name))
            .map_err(git_error)?;
        let fetch_url = remote
            .url(gix::remote::Direction::Fetch)
            .map(|url| url.to_bstring().to_string());
        let push_url = remote
            .url(gix::remote::Direction::Push)
            .map(|url| url.to_bstring().to_string());
        let github = fetch_url
            .as_deref()
            .and_then(|url| GitHubRepository::parse_with_host(url, &github_host).ok())
            .or_else(|| {
                push_url
                    .as_deref()
                    .and_then(|url| GitHubRepository::parse_with_host(url, &github_host).ok())
            });
        remotes.push(Remote {
            name: name.to_string(),
            fetch_url,
            push_url,
            github,
        });
    }
    remotes.sort_by(|left, right| {
        let left_origin = left.name != "origin";
        let right_origin = right.name != "origin";
        left_origin
            .cmp(&right_origin)
            .then_with(|| left.name.cmp(&right.name))
    });
    let github = remotes.iter().find_map(|remote| remote.github.clone());

    Ok(LocalRepository {
        root,
        git_dir,
        branch,
        head,
        dirty: !changes.is_empty(),
        changes,
        remotes,
        github,
    })
}

fn configured_github_host() -> String {
    if let Ok(host) = std::env::var("GITHUB_HOST")
        && !host.trim().is_empty()
    {
        return host.trim().to_owned();
    }
    if let Ok(server) = std::env::var("GITHUB_SERVER_URL")
        && let Ok(url) = url::Url::parse(&server)
        && let Some(host) = url.host_str()
    {
        return host.to_owned();
    }
    "github.com".to_owned()
}

fn short_ref_name(name: &str) -> String {
    name.strip_prefix("refs/heads/").unwrap_or(name).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_github_remote_forms() {
        for value in [
            "aphrody-code/aphrody-infra",
            "https://github.com/aphrody-code/aphrody-infra.git",
            "git@github.com:aphrody-code/aphrody-infra.git",
            "ssh://git@github.com/aphrody-code/aphrody-infra.git",
        ] {
            let repository = GitHubRepository::parse(value).unwrap();
            assert_eq!(repository.full_name(), "aphrody-code/aphrody-infra");
        }
    }

    #[test]
    fn rejects_non_github_remotes() {
        assert!(GitHubRepository::parse("https://gitlab.com/a/b").is_err());
        assert!(GitHubRepository::parse("missing-owner").is_err());
    }

    #[test]
    fn parses_enterprise_and_ssh_port_remotes() {
        assert_eq!(
            GitHubRepository::parse_with_host(
                "ssh://git@github.example:443/team/project.git",
                "github.example",
            )
            .unwrap()
            .full_name(),
            "team/project"
        );
        assert_eq!(
            GitHubRepository::parse_with_host(
                "git@github.example:team/project.git",
                "github.example",
            )
            .unwrap()
            .full_name(),
            "team/project"
        );
    }

    #[test]
    fn detects_untracked_files_in_new_repository() {
        let directory = tempfile::tempdir().unwrap();
        gix::init(directory.path()).unwrap();
        std::fs::write(directory.path().join("README.md"), "hello").unwrap();

        let snapshot = inspect_repository(directory.path()).unwrap();
        assert!(snapshot.dirty);
        assert_eq!(snapshot.changes.len(), 1);
        assert_eq!(snapshot.changes[0].path, "README.md");
        assert_eq!(snapshot.changes[0].path_bytes_base64, "UkVBRE1FLm1k");
        assert!(snapshot.root.is_absolute());
        assert!(snapshot.git_dir.is_absolute());
    }

    #[test]
    fn discovers_repository_from_file_path() {
        let directory = tempfile::tempdir().unwrap();
        gix::init(directory.path()).unwrap();
        let file = directory.path().join("README.md");
        std::fs::write(&file, "hello").unwrap();

        let snapshot = inspect_repository(file).unwrap();
        assert_eq!(snapshot.root, directory.path().canonicalize().unwrap());
    }
}
