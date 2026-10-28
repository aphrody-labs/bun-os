// Leaf crate on std, gix and octocrab, outside the event loop (like `bun_host`, `bun_ssh`):
// std I/O, std strings and std::process are intended here.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

// SPDX-License-Identifier: Apache-2.0

use std::fs;

use bun_git::{GitHubRepository, inspect_repository};

#[test]
fn inspection_discovers_an_unborn_repository_from_nested_file_and_directory_paths() {
    let repository = tempfile::tempdir().expect("create repository fixture");
    bun_git::gix::init(repository.path()).expect("initialize repository fixture");

    let nested = repository.path().join("src").join("nested");
    fs::create_dir_all(&nested).expect("create nested fixture directory");
    let source = nested.join("lib.rs");
    fs::write(&source, "pub fn fixture() {}\n").expect("write untracked fixture");

    let expected_root = repository.path().canonicalize().expect("canonical repository root");
    let expected_git_dir =
        repository.path().join(".git").canonicalize().expect("canonical Git directory");

    for entrypoint in [&source, &nested] {
        let snapshot = inspect_repository(entrypoint).expect("inspect repository");
        assert_eq!(snapshot.root, expected_root);
        assert_eq!(snapshot.git_dir, expected_git_dir);
        assert!(snapshot.root.is_absolute());
        assert!(snapshot.git_dir.is_absolute());
        assert_eq!(snapshot.head, None, "new repository must have an unborn HEAD");
        assert!(snapshot.dirty);
        assert!(
            snapshot.changes.iter().any(|change| {
                change.path == "src/nested/lib.rs"
                    && change.path_bytes_base64 == "c3JjL25lc3RlZC9saWIucnM="
                    && change.layer == "worktree"
            }),
            "untracked path must be reported losslessly: {:?}",
            snapshot.changes
        );
    }
}

#[test]
fn inspection_uses_a_github_push_url_when_fetch_points_elsewhere() {
    let repository = tempfile::tempdir().expect("create repository fixture");
    bun_git::gix::init(repository.path()).expect("initialize repository fixture");
    fs::write(
        repository.path().join(".git").join("config"),
        "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\n\
         [remote \"origin\"]\n\turl = https://example.invalid/mirror/project.git\n\
         \tpushurl = git@github.com:aphrody-code/push-project.git\n",
    )
    .expect("write remote configuration");

    let snapshot = inspect_repository(repository.path()).expect("inspect repository");
    let origin = snapshot.remotes.first().expect("origin remote");

    assert_eq!(origin.name, "origin");
    assert_eq!(origin.fetch_url.as_deref(), Some("https://example.invalid/mirror/project.git"));
    assert_eq!(origin.push_url.as_deref(), Some("git@github.com:aphrody-code/push-project.git"));
    assert_eq!(
        origin.github.as_ref().map(GitHubRepository::full_name).as_deref(),
        Some("aphrody-code/push-project")
    );
    assert_eq!(snapshot.github, origin.github);
}

#[test]
fn inspection_rejects_paths_outside_a_repository() {
    let directory = tempfile::tempdir().expect("create non-repository fixture");
    let error = inspect_repository(directory.path()).expect_err("non-repository must be rejected");
    assert!(error.to_string().starts_with("git operation failed:"));
}
