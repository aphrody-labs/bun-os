// SPDX-License-Identifier: Apache-2.0
//! Remote and local Git project inspection: Project Tree, Branches, Commit Graph, Diff & Worktrees.

use crate::{Error, git_error};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Branch information in a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub target_commit: Option<String>,
    pub upstream: Option<String>,
}

/// A node in a Git commit history or DAG commit graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitNode {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub timestamp_secs: i64,
    pub parents: Vec<String>,
}

/// Directed acyclic graph of commits for visualization in DrivePane / M3 Explorer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitGraph {
    pub head: Option<String>,
    pub commits: Vec<GitCommitNode>,
    pub branches: Vec<GitBranch>,
}

/// Entry in a Git object tree (for browsing commit trees without filesystem checkout).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub oid: String,
    pub mode: u32,
}

/// Summary of worktree / commit diffs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitDiffItem {
    pub path: String,
    pub status: String,
}

/// Information about a Git working tree (main or linked).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitWorktreeInfo {
    pub name: String,
    pub path: PathBuf,
    pub is_main: bool,
}

/// List all branches (local and remote) in the repository.
pub fn list_branches(path: impl AsRef<Path>) -> Result<Vec<GitBranch>, Error> {
    let repo = gix::discover(path.as_ref()).map_err(git_error)?;
    let head = repo.head().map_err(git_error)?;
    let head_ref_name = head.referent_name().map(|name| name.as_bstr().to_string());

    let mut branches = Vec::new();
    let references = repo.references().map_err(git_error)?;

    for reference in references.all().map_err(git_error)? {
        let reference = reference.map_err(git_error)?;
        let name = reference.name().as_bstr().to_string();

        let is_remote = name.starts_with("refs/remotes/");
        let is_local = name.starts_with("refs/heads/");

        if !is_local && !is_remote {
            continue;
        }

        let is_head = head_ref_name.as_deref() == Some(&name);
        let short_name = if let Some(stripped) = name.strip_prefix("refs/heads/") {
            stripped.to_string()
        } else if let Some(stripped) = name.strip_prefix("refs/remotes/") {
            stripped.to_string()
        } else {
            name
        };

        let target_commit = reference.try_id().map(|id| id.to_hex().to_string());

        branches.push(GitBranch {
            name: short_name,
            is_head,
            is_remote,
            target_commit,
            upstream: None,
        });
    }

    branches.sort_by(|a, b| {
        b.is_head
            .cmp(&a.is_head)
            .then_with(|| a.is_remote.cmp(&b.is_remote))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(branches)
}

/// Retrieve the commit log starting from HEAD up to `limit` entries.
pub fn commit_log(path: impl AsRef<Path>, limit: usize) -> Result<Vec<GitCommitNode>, Error> {
    let repo = gix::discover(path.as_ref()).map_err(git_error)?;
    let head = repo.head().map_err(git_error)?;

    if head.is_unborn() {
        return Ok(Vec::new());
    }

    let head_commit = repo.head_commit().map_err(git_error)?;
    let mut commit_nodes = Vec::new();

    let revwalk = repo.rev_walk([head_commit.id]).all().map_err(git_error)?;

    for item in revwalk {
        if commit_nodes.len() >= limit {
            break;
        }
        let info = item.map_err(git_error)?;
        let commit = repo.find_object(info.id).map_err(git_error)?.into_commit();
        let commit_ref = commit.decode().map_err(git_error)?;
        let id = commit.id().to_hex().to_string();
        let short_id = id.chars().take(7).collect();

        let message = commit_ref.message();
        let summary = message.title.to_string();
        let full_message = message
            .body
            .map(|b| format!("{summary}\n\n{b}"))
            .unwrap_or_else(|| summary.clone());

        let author = commit_ref.author().map_err(git_error)?;
        let author_name = author.name.to_string();
        let author_email = author.email.to_string();
        let timestamp_secs = commit_ref.time().map(|t| t.seconds).unwrap_or(0);

        let parents = commit_ref
            .parents()
            .map(|p| p.to_hex().to_string())
            .collect();

        commit_nodes.push(GitCommitNode {
            id,
            short_id,
            summary,
            message: full_message,
            author: author_name,
            author_email,
            timestamp_secs,
            parents,
        });
    }

    Ok(commit_nodes)
}

/// Generate a production commit graph suitable for rendering DAG views.
pub fn commit_graph(path: impl AsRef<Path>, limit: usize) -> Result<GitCommitGraph, Error> {
    let repo = gix::discover(path.as_ref()).map_err(git_error)?;
    let head_ref = repo.head().map_err(git_error)?;
    let head_commit = if head_ref.is_unborn() {
        None
    } else {
        repo.head_commit().ok().map(|c| c.id.to_hex().to_string())
    };

    let commits = commit_log(&path, limit)?;
    let branches = list_branches(&path)?;

    Ok(GitCommitGraph {
        head: head_commit,
        commits,
        branches,
    })
}

/// Browse a remote or local project tree directly from the Git object database at a given revision.
pub fn list_tree_at(
    path: impl AsRef<Path>,
    rev: Option<&str>,
    subpath: Option<&str>,
) -> Result<Vec<GitTreeNode>, Error> {
    let repo = gix::discover(path.as_ref()).map_err(git_error)?;
    let commit = if let Some(spec) = rev {
        repo.rev_parse_single(spec)
            .map_err(git_error)?
            .object()
            .map_err(git_error)?
            .into_commit()
    } else {
        repo.head_commit().map_err(git_error)?
    };

    let root_tree = commit.tree().map_err(git_error)?;
    let target_tree = if let Some(sub) = subpath.filter(|s| !s.is_empty() && *s != "/") {
        let trimmed = sub.trim_matches('/');
        let entry = root_tree.lookup_entry_by_path(trimmed).map_err(git_error)?;
        if let Some(entry) = entry {
            repo.find_object(entry.object_id())
                .map_err(git_error)?
                .into_tree()
        } else {
            return Ok(Vec::new());
        }
    } else {
        root_tree
    };

    let mut nodes = Vec::new();
    for entry in target_tree.iter() {
        let entry = entry.map_err(git_error)?;
        let filename = entry.filename().to_string();
        let is_dir = entry.mode().is_tree();
        let full_path = if let Some(sub) = subpath.filter(|s| !s.is_empty() && *s != "/") {
            format!("{}/{}", sub.trim_matches('/'), filename)
        } else {
            filename.clone()
        };

        nodes.push(GitTreeNode {
            name: filename,
            path: full_path,
            is_dir,
            oid: entry.object_id().to_hex().to_string(),
            mode: entry.mode().value() as u32,
        });
    }

    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(nodes)
}

/// Enumerate all linked working trees.
pub fn list_worktrees(path: impl AsRef<Path>) -> Result<Vec<GitWorktreeInfo>, Error> {
    let repo = gix::discover(path.as_ref()).map_err(git_error)?;
    let mut worktrees = Vec::new();

    if let Some(workdir) = repo.workdir() {
        worktrees.push(GitWorktreeInfo {
            name: "main".into(),
            path: workdir.to_path_buf(),
            is_main: true,
        });
    }

    for wt in repo.worktrees().map_err(git_error)? {
        let name = wt.id().to_string();
        let base = wt.base().map_err(git_error)?;
        worktrees.push(GitWorktreeInfo {
            name,
            path: base,
            is_main: false,
        });
    }

    Ok(worktrees)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn branch_fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("repository fixture");
        for args in [
            vec!["init", "--initial-branch=main"],
            vec![
                "-c",
                "user.name=aphrody-dev",
                "-c",
                "user.email=contact@aphrody.com",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--allow-empty",
                "-m",
                "branch fixture",
            ],
        ] {
            let output = std::process::Command::new("git")
                .current_dir(dir.path())
                .args(args)
                .output()
                .expect("fixture git command");
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        dir
    }

    #[test]
    fn test_list_branches_identifies_attached_head() {
        let dir = branch_fixture();
        let branches = list_branches(dir.path()).expect("list_branches");
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_head);
    }

    #[test]
    fn test_list_branches_accepts_detached_snapshot_without_branch_refs() {
        let dir = branch_fixture();
        for args in [
            vec!["checkout", "--detach"],
            vec!["update-ref", "-d", "refs/heads/main"],
        ] {
            assert!(
                std::process::Command::new("git")
                    .current_dir(dir.path())
                    .args(args)
                    .status()
                    .expect("detach fixture")
                    .success()
            );
        }
        assert!(
            list_branches(dir.path())
                .expect("detached branches")
                .is_empty()
        );
    }

    #[test]
    fn test_commit_log_in_current_repo() {
        let log = commit_log(".", 5).expect("commit_log");
        assert!(!log.is_empty());
        assert_eq!(log[0].short_id.len(), 7);
    }

    #[test]
    fn test_commit_graph_in_current_repo() {
        let graph = commit_graph(".", 5).expect("commit_graph");
        assert!(graph.head.is_some());
        assert!(!graph.commits.is_empty());
    }

    #[test]
    fn test_list_tree_at_head() {
        let tree = list_tree_at(".", None, None).expect("list_tree_at");
        assert!(!tree.is_empty());
        assert!(tree.iter().any(|node| node.name == "Cargo.toml"));
    }

    #[test]
    fn test_list_worktrees() {
        let wts = list_worktrees(".").expect("list_worktrees");
        assert!(!wts.is_empty());
        assert!(wts[0].is_main);
    }
}
