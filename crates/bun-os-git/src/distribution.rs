// SPDX-License-Identifier: Apache-2.0
//! Safe installation of the thin workflow used by ecosystem repositories.

use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{ApiMethod, Error, GitHubClient, GitHubRepository, io_error};

/// Relative location of the managed workflow in a consumer repository.
pub const CONSUMER_WORKFLOW_PATH: &str = ".github/workflows/aphrody-ci.yml";
const MANAGED_MARKER: &str = "# Managed by aphrody-git.";

/// State of the managed caller in a remote ecosystem repository.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowState {
    /// The repository has no default branch yet.
    EmptyRepository,
    /// No workflow exists at the managed path.
    Missing,
    /// The managed workflow exactly matches the requested source ref.
    Current,
    /// Aphrody owns the existing workflow, but its content is outdated.
    ManagedOutdated,
    /// A user-owned workflow occupies the managed path and was preserved.
    Unmanaged,
    /// GitHub could not inspect or update this repository.
    Error,
}

/// Audit or rollout result for one GitHub repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EcosystemOutcome {
    /// Canonical `owner/name` identifier.
    pub repository: String,
    /// Default branch receiving the workflow.
    pub default_branch: Option<String>,
    /// Observed state after a successful apply, or at audit time for a plan.
    pub state: WorkflowState,
    /// Whether a remote commit was created.
    pub written: bool,
    /// Commit SHA returned by GitHub when a write succeeded.
    pub commit: Option<String>,
    /// Per-repository diagnostic; failures do not stop the remaining rollout.
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RepositoryResource {
    name: String,
    archived: bool,
    fork: bool,
    default_branch: Option<String>,
    owner: RepositoryOwner,
}

#[derive(Debug, Deserialize)]
struct RepositoryOwner {
    login: String,
}

#[derive(Debug, Deserialize)]
struct ContentResource {
    content: String,
    encoding: String,
    sha: String,
}

/// Whether installation only plans or writes the workflow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallMode {
    /// Compute the outcome without modifying the consumer repository.
    Plan,
    /// Create or update the managed file.
    Apply,
}

/// Result of installing the consumer workflow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallOutcome {
    /// Destination file.
    pub path: PathBuf,
    /// Whether the destination already matched the requested content.
    pub unchanged: bool,
    /// Whether bytes were written.
    pub written: bool,
    /// Source ref used by the remote reusable workflow.
    pub source_ref: String,
}

/// Render a thin caller for Aphrody's reusable CI workflow.
pub fn render_consumer_workflow(source_ref: &str) -> Result<String, Error> {
    validate_source_ref(source_ref)?;
    Ok(format!(
        "# SPDX-License-Identifier: Apache-2.0\n{MANAGED_MARKER}\nname: Aphrody ecosystem \
         CI\n\non:\n  push:\n  pull_request:\n  workflow_dispatch:\n\npermissions:\n  contents: \
         read\n\njobs:\n  aphrody:\n    uses: \
         aphrody-code/aphrody-infra/.github/workflows/aphrody-reusable-ci.yml@{source_ref}\n"
    ))
}

fn validate_source_ref(source_ref: &str) -> Result<(), Error> {
    let invalid = source_ref.is_empty()
        || source_ref.len() > 255
        || source_ref != source_ref.trim()
        || source_ref == "@"
        || source_ref.starts_with('/')
        || source_ref.ends_with('/')
        || source_ref.ends_with('.')
        || source_ref.contains("..")
        || source_ref.contains("//")
        || source_ref.contains("@{")
        || source_ref
            .split('/')
            .any(|component| component.ends_with(".lock"))
        || source_ref.chars().any(|character| {
            character.is_control()
                || character.is_whitespace()
                || matches!(character, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        });
    if invalid {
        return Err(Error::Git(format!(
            "invalid workflow source ref `{source_ref}`"
        )));
    }
    Ok(())
}

/// Install the managed caller in one repository.
///
/// Existing unmanaged files are never overwritten. `Plan` is the default mode
/// at CLI level, allowing a whole organization rollout to be reviewed first.
pub fn install_consumer_workflow(
    repository_root: impl AsRef<Path>,
    source_ref: &str,
    mode: InstallMode,
) -> Result<InstallOutcome, Error> {
    let repository_root = repository_root.as_ref();
    if !repository_root.join(".git").exists() {
        return Err(Error::Git(format!(
            "`{}` is not a repository root",
            repository_root.display()
        )));
    }
    let path = repository_root.join(CONSUMER_WORKFLOW_PATH);
    ensure_safe_local_path(repository_root, &path)?;
    let rendered = render_consumer_workflow(source_ref)?;
    if path.exists() {
        let current = std::fs::read_to_string(&path)
            .map_err(|error| io_error("read", path.clone(), error))?;
        if current == rendered {
            return Ok(InstallOutcome {
                path,
                unchanged: true,
                written: false,
                source_ref: source_ref.to_owned(),
            });
        }
        if !current.contains(MANAGED_MARKER) {
            return Err(Error::UnmanagedWorkflow(path));
        }
    }

    let written = mode == InstallMode::Apply;
    if written {
        let parent = path.parent().expect("workflow path always has a parent");
        ensure_safe_local_path(repository_root, &path)?;
        std::fs::create_dir_all(parent)
            .map_err(|error| io_error("create directory", parent, error))?;
        ensure_safe_local_path(repository_root, &path)?;
        std::fs::write(&path, rendered).map_err(|error| io_error("write", &path, error))?;
    }
    Ok(InstallOutcome {
        path,
        unchanged: false,
        written,
        source_ref: source_ref.to_owned(),
    })
}

fn ensure_safe_local_path(repository_root: &Path, target: &Path) -> Result<(), Error> {
    let canonical_root = std::fs::canonicalize(repository_root)
        .map_err(|error| io_error("canonicalize repository root", repository_root, error))?;
    let mut current = repository_root.to_path_buf();
    for component in Path::new(CONSUMER_WORKFLOW_PATH).components() {
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(Error::UnsafeWorkflowPath(current));
            }
            Ok(_) => {
                if current.is_dir() {
                    let canonical = std::fs::canonicalize(&current)
                        .map_err(|error| io_error("canonicalize workflow path", &current, error))?;
                    if !canonical.starts_with(&canonical_root) {
                        return Err(Error::UnsafeWorkflowPath(current));
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(io_error("inspect workflow path", &current, error)),
        }
    }
    if !target.starts_with(repository_root) {
        return Err(Error::UnsafeWorkflowPath(target.to_path_buf()));
    }
    Ok(())
}

/// Audit every active repository owned by `owner` without mutating GitHub.
pub async fn audit_ecosystem_workflows(
    client: &GitHubClient,
    owner: &str,
    source_ref: &str,
    include_forks: bool,
) -> Result<Vec<EcosystemOutcome>, Error> {
    rollout_ecosystem_workflows(
        client,
        owner,
        source_ref,
        include_forks,
        &[],
        InstallMode::Plan,
    )
    .await
}

/// Install or update the managed caller across GitHub repositories.
///
/// Archived repositories and, by default, forks are excluded. `repositories`
/// optionally limits the rollout to repository names owned by `owner`.
pub async fn rollout_ecosystem_workflows(
    client: &GitHubClient,
    owner: &str,
    source_ref: &str,
    include_forks: bool,
    repositories: &[String],
    mode: InstallMode,
) -> Result<Vec<EcosystemOutcome>, Error> {
    GitHubRepository::parse(&format!("{owner}/validation"))?;
    let rendered = render_consumer_workflow(source_ref)?;
    if mode == InstallMode::Apply && !is_full_commit_sha(source_ref) {
        return Err(Error::Git(
            "remote rollout requires a full 40-character commit SHA".to_owned(),
        ));
    }
    if mode == InstallMode::Apply {
        verify_published_source(client, source_ref).await?;
    }
    for repository in repositories {
        GitHubRepository::parse(&format!("{owner}/{repository}"))?;
    }
    let owner_kind = client
        .request(ApiMethod::Get, &format!("/users/{owner}"), None)
        .await?;
    let is_organization = owner_kind
        .body
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "Organization");
    let mut targets = list_owned_repositories(client, owner, is_organization).await?;
    targets.retain(|repository| {
        repository.owner.login.eq_ignore_ascii_case(owner)
            && !repository.archived
            && (include_forks || !repository.fork)
            && (repositories.is_empty() || repositories.contains(&repository.name))
    });
    for requested in repositories {
        if !targets
            .iter()
            .any(|repository| &repository.name == requested)
        {
            return Err(Error::Git(format!(
                "requested repository `{owner}/{requested}` is unavailable or ineligible"
            )));
        }
    }
    targets.sort_by(|left, right| left.name.cmp(&right.name));

    let mut outcomes = Vec::with_capacity(targets.len());
    for repository in targets {
        outcomes
            .push(inspect_or_rollout_repository(client, owner, repository, &rendered, mode).await);
    }
    Ok(outcomes)
}

async fn verify_published_source(client: &GitHubClient, source_ref: &str) -> Result<(), Error> {
    for path in [
        ".github/workflows/aphrody-reusable-ci.yml",
        ".github/actions/aphrody-toolkit/action.yml",
    ] {
        let route = format!("/repos/aphrody-code/aphrody-infra/contents/{path}?ref={source_ref}");
        client
            .request(ApiMethod::Get, &route, None)
            .await
            .map_err(|error| {
                Error::Git(format!(
                    "source artifact `{path}` is not available at `{source_ref}`: {error}"
                ))
            })?;
    }
    Ok(())
}

fn is_full_commit_sha(source_ref: &str) -> bool {
    source_ref.len() == 40 && source_ref.bytes().all(|byte| byte.is_ascii_hexdigit())
}

async fn list_owned_repositories(
    client: &GitHubClient,
    owner: &str,
    is_organization: bool,
) -> Result<Vec<RepositoryResource>, Error> {
    let mut repositories = Vec::new();
    for page in 1.. {
        let route = if is_organization {
            format!("/orgs/{owner}/repos?type=all&sort=full_name&per_page=100&page={page}")
        } else if client.is_authenticated() {
            format!(
                "/user/repos?affiliation=owner&visibility=all&sort=full_name&per_page=100&\
                 page={page}"
            )
        } else {
            format!("/users/{owner}/repos?type=owner&sort=full_name&per_page=100&page={page}")
        };
        let response = client.request(ApiMethod::Get, &route, None).await?;
        let page_repositories: Vec<RepositoryResource> = serde_json::from_value(response.body)?;
        let done = page_repositories.len() < 100;
        repositories.extend(page_repositories);
        if done {
            break;
        }
    }
    Ok(repositories)
}

async fn inspect_or_rollout_repository(
    client: &GitHubClient,
    owner: &str,
    repository: RepositoryResource,
    rendered: &str,
    mode: InstallMode,
) -> EcosystemOutcome {
    let full_name = format!("{owner}/{}", repository.name);
    let Some(default_branch) = repository
        .default_branch
        .filter(|branch| !branch.is_empty())
    else {
        return EcosystemOutcome {
            repository: full_name,
            default_branch: None,
            state: WorkflowState::EmptyRepository,
            written: false,
            commit: None,
            error: None,
        };
    };
    let route = format!(
        "/repos/{owner}/{}/contents/{}",
        repository.name, CONSUMER_WORKFLOW_PATH
    );
    let content = match client.request(ApiMethod::Get, &route, None).await {
        Ok(response) => match serde_json::from_value::<ContentResource>(response.body) {
            Ok(content) => Some(content),
            Err(error) => {
                return failed_outcome(full_name, default_branch, error.to_string());
            }
        },
        Err(Error::GitHubStatus { status: 404, .. }) => {
            let branch_route = format!(
                "/repos/{owner}/{}/commits/{default_branch}",
                repository.name
            );
            match client.request(ApiMethod::Get, &branch_route, None).await {
                Ok(_) => None,
                Err(Error::GitHubStatus {
                    status: 404 | 409, ..
                }) => {
                    return EcosystemOutcome {
                        repository: full_name,
                        default_branch: Some(default_branch),
                        state: WorkflowState::EmptyRepository,
                        written: false,
                        commit: None,
                        error: None,
                    };
                }
                Err(error) => {
                    return failed_outcome(full_name, default_branch, error.to_string());
                }
            }
        }
        Err(error) => return failed_outcome(full_name, default_branch, error.to_string()),
    };

    let (state, existing_sha) = match content {
        None => (WorkflowState::Missing, None),
        Some(content) => {
            if content.encoding != "base64" {
                return failed_outcome(
                    full_name,
                    default_branch,
                    format!("unsupported GitHub content encoding `{}`", content.encoding),
                );
            }
            let compact: String = content
                .content
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            let decoded = match BASE64.decode(compact) {
                Ok(decoded) => decoded,
                Err(error) => {
                    return failed_outcome(full_name, default_branch, error.to_string());
                }
            };
            if decoded == rendered.as_bytes() {
                (WorkflowState::Current, Some(content.sha))
            } else if decoded
                .windows(MANAGED_MARKER.len())
                .any(|window| window == MANAGED_MARKER.as_bytes())
            {
                (WorkflowState::ManagedOutdated, Some(content.sha))
            } else {
                (WorkflowState::Unmanaged, Some(content.sha))
            }
        }
    };

    if mode == InstallMode::Plan
        || matches!(state, WorkflowState::Current | WorkflowState::Unmanaged)
    {
        return EcosystemOutcome {
            repository: full_name,
            default_branch: Some(default_branch),
            state,
            written: false,
            commit: None,
            error: None,
        };
    }

    let mut body = json!({
        "message": "chore: adopt Aphrody ecosystem CI",
        "content": BASE64.encode(rendered.as_bytes()),
        "branch": default_branch,
    });
    if let Some(sha) = existing_sha {
        body["sha"] = Value::String(sha);
    }
    match client.request(ApiMethod::Put, &route, Some(&body)).await {
        Ok(response) => EcosystemOutcome {
            repository: full_name,
            default_branch: Some(default_branch),
            state: WorkflowState::Current,
            written: true,
            commit: response
                .body
                .pointer("/commit/sha")
                .and_then(Value::as_str)
                .map(str::to_owned),
            error: None,
        },
        Err(error) => failed_outcome(full_name, default_branch, error.to_string()),
    }
}

fn failed_outcome(repository: String, default_branch: String, error: String) -> EcosystemOutcome {
    EcosystemOutcome {
        repository,
        default_branch: Some(default_branch),
        state: WorkflowState::Error,
        written: false,
        commit: None,
        error: Some(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planning_does_not_write() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join(".git")).unwrap();
        let outcome =
            install_consumer_workflow(directory.path(), "main", InstallMode::Plan).unwrap();
        assert!(!outcome.written);
        assert!(!outcome.path.exists());
    }

    #[test]
    fn apply_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join(".git")).unwrap();
        let first =
            install_consumer_workflow(directory.path(), "main", InstallMode::Apply).unwrap();
        assert!(first.written);
        let second =
            install_consumer_workflow(directory.path(), "main", InstallMode::Apply).unwrap();
        assert!(second.unchanged);
        assert!(!second.written);
    }

    #[test]
    fn unmanaged_workflow_is_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join(CONSUMER_WORKFLOW_PATH);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::create_dir(directory.path().join(".git")).unwrap();
        std::fs::write(&target, "name: user owned\n").unwrap();
        assert!(matches!(
            install_consumer_workflow(directory.path(), "main", InstallMode::Apply),
            Err(Error::UnmanagedWorkflow(_))
        ));
        assert_eq!(
            std::fs::read_to_string(target).unwrap(),
            "name: user owned\n"
        );
    }

    #[test]
    fn rejects_source_ref_injection() {
        for source_ref in [
            "",
            "main\npermissions: write-all",
            "../main",
            "refs//heads/main",
        ] {
            assert!(
                render_consumer_workflow(source_ref).is_err(),
                "{source_ref:?}"
            );
        }
        assert!(render_consumer_workflow("release/v1.2.3").is_ok());
        assert!(render_consumer_workflow("0123456789abcdef").is_ok());
    }

    #[test]
    fn recognizes_only_full_commit_sha_as_immutable() {
        assert!(is_full_commit_sha(
            "0123456789abcdef0123456789abcdef01234567"
        ));
        assert!(!is_full_commit_sha("main"));
        assert!(!is_full_commit_sha("0123456789abcdef"));
        assert!(!is_full_commit_sha(
            "g123456789abcdef0123456789abcdef01234567"
        ));
    }
}
