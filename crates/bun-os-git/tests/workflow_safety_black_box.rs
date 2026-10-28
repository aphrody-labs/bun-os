// Leaf crate on std, gix and octocrab, outside the event loop (like `bun_host`, `bun_ssh`):
// std I/O, std strings and std::process are intended here.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

// SPDX-License-Identifier: Apache-2.0

use std::{fs, io, path::Path};

use bun_git::{
    CONSUMER_WORKFLOW_PATH, Error, InstallMode, install_consumer_workflow, render_consumer_workflow,
};

fn repository_fixture() -> tempfile::TempDir {
    let repository = tempfile::tempdir().expect("create repository fixture");
    bun_git::gix::init(repository.path()).expect("initialize repository fixture");
    repository
}

#[test]
fn invalid_git_refs_are_rejected_without_creating_a_workflow() {
    let repository = repository_fixture();
    let too_long = "a".repeat(256);
    let invalid = [
        "",
        " main",
        "main ",
        "@",
        "/main",
        "main/",
        "main.",
        "feature..branch",
        "refs//heads/main",
        "refs/heads/release.lock",
        "refs/heads/@{upstream}",
        "main~1",
        "main^",
        "main:next",
        "main?",
        "main*",
        "main[0]",
        "main\\next",
        "main next",
        "main\npermissions: write-all",
        too_long.as_str(),
    ];

    for source_ref in invalid {
        assert!(
            matches!(render_consumer_workflow(source_ref), Err(Error::Git(_))),
            "invalid ref was accepted by renderer: {source_ref:?}"
        );
        assert!(
            matches!(
                install_consumer_workflow(repository.path(), source_ref, InstallMode::Apply),
                Err(Error::Git(_))
            ),
            "invalid ref was accepted by installer: {source_ref:?}"
        );
    }

    assert!(!repository.path().join(CONSUMER_WORKFLOW_PATH).exists());
}

#[test]
fn valid_refs_render_as_one_inert_uses_value() {
    for source_ref in ["main", "release/v1.2.3", "0123456789abcdef0123456789abcdef01234567"] {
        let rendered = render_consumer_workflow(source_ref).expect("render valid ref");
        let uses_lines: Vec<_> =
            rendered.lines().filter(|line| line.trim().starts_with("uses:")).collect();
        assert_eq!(uses_lines.len(), 1);
        assert_eq!(
            uses_lines[0].trim(),
            format!(
                "uses: aphrody-code/aphrody-infra/.github/workflows/aphrody-reusable-ci.yml@{source_ref}"
            )
        );
    }
}

#[test]
fn unmanaged_workflow_is_rejected_and_preserved_in_plan_and_apply_modes() {
    let repository = repository_fixture();
    let workflow = repository.path().join(CONSUMER_WORKFLOW_PATH);
    fs::create_dir_all(workflow.parent().expect("workflow parent")).expect("create workflow dir");
    let user_content = b"# user-owned workflow\nname: Existing CI\n";
    fs::write(&workflow, user_content).expect("write user workflow");

    for mode in [InstallMode::Plan, InstallMode::Apply] {
        let error = install_consumer_workflow(repository.path(), "main", mode)
            .expect_err("unmanaged workflow must be rejected");
        match error {
            Error::UnmanagedWorkflow(path) => assert_eq!(path, workflow),
            other => panic!("unexpected error: {other}"),
        }
        assert_eq!(fs::read(&workflow).expect("read preserved workflow"), user_content);
    }
}

#[test]
fn apply_is_idempotent_and_plan_is_side_effect_free() {
    let repository = repository_fixture();
    let planned = install_consumer_workflow(repository.path(), "release/v1", InstallMode::Plan)
        .expect("plan workflow");
    assert!(!planned.written);
    assert!(!planned.unchanged);
    assert!(!planned.path.exists());

    let applied = install_consumer_workflow(repository.path(), "release/v1", InstallMode::Apply)
        .expect("apply workflow");
    assert!(applied.written);
    assert!(!applied.unchanged);
    assert_eq!(applied.path, planned.path);
    assert_eq!(applied.source_ref, "release/v1");

    let repeated = install_consumer_workflow(repository.path(), "release/v1", InstallMode::Apply)
        .expect("repeat workflow apply");
    assert!(!repeated.written);
    assert!(repeated.unchanged);
    assert_eq!(
        fs::read_to_string(repeated.path).expect("read workflow"),
        render_consumer_workflow("release/v1").unwrap()
    );
}

#[cfg(any(unix, windows))]
#[test]
fn apply_refuses_a_symlinked_workflow_directory_and_does_not_escape() {
    let repository = repository_fixture();
    let outside = tempfile::tempdir().expect("create outside fixture");
    let github = repository.path().join(".github");

    if !try_symlink_dir(outside.path(), &github) {
        return;
    }

    let error = install_consumer_workflow(repository.path(), "main", InstallMode::Apply)
        .expect_err("symlink traversal must be rejected");
    assert!(matches!(error, Error::UnsafeWorkflowPath(path) if path == github));
    assert!(!outside.path().join("workflows").join("aphrody-ci.yml").exists());
}

#[cfg(unix)]
fn try_symlink_dir(target: &Path, link: &Path) -> bool {
    handle_symlink_result(std::os::unix::fs::symlink(target, link))
}

#[cfg(windows)]
fn try_symlink_dir(target: &Path, link: &Path) -> bool {
    handle_symlink_result(std::os::windows::fs::symlink_dir(target, link))
}

#[cfg(any(unix, windows))]
fn handle_symlink_result(result: io::Result<()>) -> bool {
    match result {
        Ok(()) => true,
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::PermissionDenied | io::ErrorKind::Unsupported
            ) =>
        {
            false
        },
        Err(error) => panic!("create symlink fixture: {error}"),
    }
}
