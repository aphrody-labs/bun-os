// SPDX-License-Identifier: Apache-2.0
//! Commit history of a local repository: recent log, change hotspots and divergence from remote
//! branches, read with gix without shelling out.

use std::{collections::HashMap, path::Path};

use serde::{Deserialize, Serialize};

use crate::{Error, git_error};

/// What to read beyond the repository snapshot.
#[derive(Debug, Clone, Default)]
pub struct HistoryOptions {
    /// Number of most recent first-parent commits to list.
    pub log: usize,
    /// Number of most changed files to list.
    pub hotspots: usize,
    /// First-parent commits scanned for hotspots.
    pub window: usize,
    /// Revisions to compare `HEAD` with (`upstream/main`, `origin/main`). Empty: the upstream
    /// tracking branch of the current branch and every `<remote>/<branch>` of the same name.
    pub against: Vec<String>,
}

/// One commit of the log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogEntry {
    /// Full commit id.
    pub id: String,
    /// Author name.
    pub author: String,
    /// Author time, seconds since the Unix epoch.
    pub time: i64,
    /// First line of the message.
    pub summary: String,
}

/// A file and the number of scanned commits that changed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hotspot {
    /// Repository-relative path.
    pub path: String,
    /// Commits touching it inside the window.
    pub commits: usize,
}

/// Commits on `HEAD` and not on `against` (ahead), and the reverse (behind).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Divergence {
    /// The compared revision as given or as a short remote ref (`origin/main`).
    pub against: String,
    /// Its commit id.
    pub against_head: String,
    /// Commits reachable from `HEAD` only.
    pub ahead: usize,
    /// Commits reachable from `against` only.
    pub behind: usize,
}

/// History report of a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct History {
    /// Divergence from each compared revision.
    pub divergence: Vec<Divergence>,
    /// Most recent first-parent commits.
    pub log: Vec<LogEntry>,
    /// First-parent commits scanned for hotspots.
    pub hotspot_window: usize,
    /// Most changed files, most commits first.
    pub hotspots: Vec<Hotspot>,
}

/// Read the history of the repository containing `path`.
pub fn repository_history(
    path: impl AsRef<Path>,
    options: &HistoryOptions,
) -> Result<History, Error> {
    let requested = path.as_ref();
    let discovery = if requested.is_file() {
        requested.parent().unwrap_or(requested)
    } else {
        requested
    };
    let repository = gix::discover(discovery).map_err(git_error)?;
    let head = match repository.head_id() {
        Ok(id) => id.detach(),
        Err(_) => return Ok(History::default()),
    };
    let mut history = History::default();
    for (label, id) in compared_revisions(&repository, &options.against)? {
        let count = |tip: gix::ObjectId, hidden: gix::ObjectId| -> Result<usize, Error> {
            Ok(repository
                .rev_walk([tip])
                .with_hidden([hidden])
                .all()
                .map_err(git_error)?
                .count())
        };
        history.divergence.push(Divergence {
            against: label,
            against_head: id.to_hex().to_string(),
            ahead: count(head, id)?,
            behind: count(id, head)?,
        });
    }

    let wanted = options.log.max(options.window);
    if wanted == 0 {
        return Ok(history);
    }
    let walk = repository
        .rev_walk([head])
        .first_parent_only()
        .all()
        .map_err(git_error)?;
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut scanned = 0;
    for info in walk.take(wanted) {
        let info = info.map_err(git_error)?;
        let commit = info.object().map_err(git_error)?;
        if history.log.len() < options.log {
            let author = commit.author().map_err(git_error)?;
            history.log.push(LogEntry {
                id: commit.id.to_hex().to_string(),
                author: author.name.to_string(),
                time: author.time().map(|t| t.seconds).unwrap_or_default(),
                summary: commit.message().map_err(git_error)?.summary().to_string(),
            });
        }
        if scanned < options.window && options.hotspots > 0 {
            scanned += 1;
            let tree = commit.tree().map_err(git_error)?;
            let parent = match commit.parent_ids().next() {
                Some(parent) => Some(
                    parent
                        .object()
                        .map_err(git_error)?
                        .into_commit()
                        .tree()
                        .map_err(git_error)?,
                ),
                None => None,
            };
            let changes = repository
                .diff_tree_to_tree(parent.as_ref(), Some(&tree), gix::diff::Options::default())
                .map_err(git_error)?;
            for change in changes {
                if !change.entry_mode().is_tree() {
                    *counts.entry(change.location().to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    history.hotspot_window = scanned;
    let mut hotspots: Vec<Hotspot> = counts
        .into_iter()
        .map(|(path, commits)| Hotspot { path, commits })
        .collect();
    hotspots.sort_by(|a, b| b.commits.cmp(&a.commits).then_with(|| a.path.cmp(&b.path)));
    hotspots.truncate(options.hotspots);
    history.hotspots = hotspots;
    Ok(history)
}

/// Revisions to compare `HEAD` with, labelled, deduplicated by label.
fn compared_revisions(
    repository: &gix::Repository,
    against: &[String],
) -> Result<Vec<(String, gix::ObjectId)>, Error> {
    let mut out: Vec<(String, gix::ObjectId)> = Vec::new();
    let mut push = |label: String, id: gix::ObjectId| {
        if !out.iter().any(|(existing, _)| *existing == label) {
            out.push((label, id));
        }
    };
    if !against.is_empty() {
        for revision in against {
            let id = repository
                .rev_parse_single(revision.as_str())
                .map_err(|error| Error::Git(format!("cannot resolve `{revision}`: {error}")))?;
            push(revision.clone(), id.detach());
        }
        return Ok(out);
    }
    let Ok(Some(head_ref)) = repository.head_ref() else {
        return Ok(out);
    };
    let branch = head_ref.name().shorten().to_string();
    let mut names = Vec::new();
    if let Some(Ok(tracking)) =
        repository.branch_remote_tracking_ref_name(head_ref.name(), gix::remote::Direction::Fetch)
    {
        names.push(tracking.as_bstr().to_string());
    }
    for remote in repository.remote_names() {
        names.push(format!("refs/remotes/{remote}/{branch}"));
    }
    for name in names {
        if let Ok(mut reference) = repository.find_reference(name.as_str())
            && let Ok(id) = reference.peel_to_id()
        {
            let label = name
                .strip_prefix("refs/remotes/")
                .unwrap_or(&name)
                .to_owned();
            push(label, id.detach());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
            .args([
                "-c",
                "commit.gpgsign=false",
                "-c",
                "init.defaultBranch=main",
            ])
            .args(args)
            .current_dir(dir)
            .output()
            .is_ok_and(|o| o.status.success())
    }

    fn commit(dir: &Path, file: &str, text: &str, message: &str) {
        std::fs::write(dir.join(file), text).unwrap();
        assert!(git(dir, &["add", file]));
        assert!(git(dir, &["commit", "-q", "-m", message]));
    }

    #[test]
    fn log_hotspots_and_divergence_from_remote_branches() {
        let root = tempfile::tempdir().unwrap();
        let remote = root.path().join("remote");
        let work = root.path().join("work");
        std::fs::create_dir_all(&remote).unwrap();
        if !git(&remote, &["init", "-q"]) {
            eprintln!("skipped: git is unavailable");
            return;
        }
        commit(&remote, "a.rs", "1", "first");
        commit(&remote, "b.rs", "1", "second");
        assert!(git(root.path(), &["clone", "-q", "remote", "work"]));
        commit(&remote, "c.rs", "1", "upstream only");
        assert!(git(&work, &["fetch", "-q", "origin"]));
        commit(&work, "a.rs", "2", "local one");
        commit(&work, "a.rs", "3", "local two");

        let options = HistoryOptions {
            log: 2,
            hotspots: 2,
            window: 10,
            against: Vec::new(),
        };
        let history = repository_history(&work, &options).unwrap();
        assert_eq!(
            history
                .divergence
                .iter()
                .map(|d| (d.against.as_str(), d.ahead, d.behind))
                .collect::<Vec<_>>(),
            [("origin/main", 2, 1)]
        );
        assert_eq!(
            history
                .log
                .iter()
                .map(|e| e.summary.as_str())
                .collect::<Vec<_>>(),
            ["local two", "local one"]
        );
        assert_eq!(history.log[0].author, "Test");
        assert_eq!(history.hotspot_window, 4);
        assert_eq!(
            history.hotspots,
            [
                Hotspot {
                    path: "a.rs".into(),
                    commits: 3
                },
                Hotspot {
                    path: "b.rs".into(),
                    commits: 1
                }
            ]
        );

        let explicit = HistoryOptions {
            against: vec!["HEAD~2".into()],
            ..HistoryOptions::default()
        };
        let history = repository_history(&work, &explicit).unwrap();
        assert_eq!(
            (history.divergence[0].ahead, history.divergence[0].behind),
            (2, 0)
        );
        assert!(history.log.is_empty() && history.hotspots.is_empty());
        let missing = HistoryOptions {
            against: vec!["nope/main".into()],
            ..HistoryOptions::default()
        };
        assert!(repository_history(&work, &missing).is_err());
    }
}
