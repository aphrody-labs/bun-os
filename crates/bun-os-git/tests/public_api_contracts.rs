// Leaf crate on std, gix and octocrab, outside the event loop (like `bun_host`, `bun_ssh`):
// std I/O, std strings and std::process are intended here.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

// SPDX-License-Identifier: Apache-2.0

use std::str::FromStr;

use bun_git::{
    ApiMethod, Change, EcosystemOutcome, Error, GitHubClient, GitHubRepository, Remote,
    WorkflowState,
};
use serde_json::json;

/// Install a rustls crypto provider exactly once for this test binary.
///
/// Without it the first `reqwest::Client` construction panics — rustls 0.23
/// cannot choose between `ring` and `aws-lc-rs` on its own, and a test binary
/// runs none of the startup code where the real binaries install one.
fn install_rustls_provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        // Already installed by another test in this binary: fine, that is the
        // outcome we wanted.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

#[test]
fn repository_references_support_documented_forms_and_reject_impostors() {
    for reference in [
        "aphrody-code/aphrody-infra",
        "https://github.com/aphrody-code/aphrody-infra.git",
        "git@github.com:aphrody-code/aphrody-infra.git",
        "ssh://git@github.com:443/aphrody-code/aphrody-infra.git",
    ] {
        let parsed = GitHubRepository::parse(reference).expect("parse documented GitHub form");
        assert_eq!(parsed.owner, "aphrody-code");
        assert_eq!(parsed.name, "aphrody-infra");
        assert_eq!(parsed.full_name(), "aphrody-code/aphrody-infra");
        assert_eq!(parsed.to_string(), "aphrody-code/aphrody-infra");
    }

    for reference in [
        "missing-owner",
        "/repository",
        "owner/",
        "owner/repository/extra",
        "-owner/repository",
        "owner-/repository",
        "owner/repo name",
        "https://gitlab.com/aphrody-code/aphrody-infra",
        "https://github.com.evil.invalid/aphrody-code/aphrody-infra",
    ] {
        assert!(
            matches!(GitHubRepository::parse(reference), Err(Error::InvalidRepository(_))),
            "invalid repository reference was accepted: {reference:?}"
        );
    }
}

#[test]
fn enterprise_repository_parsing_is_host_scoped() {
    let parsed = GitHubRepository::parse_with_host(
        "ssh://git@github.internal.example:443/team/service.git",
        "github.internal.example",
    )
    .expect("parse enterprise remote");
    assert_eq!(parsed.full_name(), "team/service");
    assert!(GitHubRepository::parse("team/service").is_ok());
    assert!(GitHubRepository::parse("https://github.internal.example/team/service").is_err());
}

#[test]
fn api_methods_have_stable_parse_display_mutability_and_json_contracts() {
    for (input, method, mutating) in [
        ("get", ApiMethod::Get, false),
        ("POST", ApiMethod::Post, true),
        ("Patch", ApiMethod::Patch, true),
        ("put", ApiMethod::Put, true),
        ("DELETE", ApiMethod::Delete, true),
    ] {
        assert_eq!(ApiMethod::from_str(input).expect("parse method"), method);
        assert_eq!(method.to_string(), input.to_ascii_uppercase());
        assert_eq!(method.is_mutating(), mutating);
        assert_eq!(
            serde_json::to_value(method).expect("serialize method"),
            json!(input.to_ascii_uppercase())
        );
    }
    assert!(matches!(ApiMethod::from_str("TRACE"), Err(Error::Git(_))));
}

#[test]
fn exported_snapshot_types_keep_their_serialized_field_contract() {
    let repository = GitHubRepository { owner: "aphrody-code".into(), name: "aphrody".into() };
    let remote = Remote {
        name: "origin".into(),
        fetch_url: Some("https://github.com/aphrody-code/aphrody-infra.git".into()),
        push_url: None,
        github: Some(repository),
    };
    let change = Change {
        path: "README.md".into(),
        path_bytes_base64: "UkVBRE1FLm1k".into(),
        layer: "worktree".into(),
    };
    let outcome = EcosystemOutcome {
        repository: "aphrody-code/aphrody-infra".into(),
        default_branch: Some("main".into()),
        state: WorkflowState::ManagedOutdated,
        written: false,
        commit: None,
        error: None,
    };

    assert_eq!(serde_json::to_value(remote).expect("serialize remote")["name"], "origin");
    assert_eq!(
        serde_json::to_value(change).expect("serialize change"),
        json!({
            "path": "README.md",
            "path_bytes_base64": "UkVBRE1FLm1k",
            "layer": "worktree"
        })
    );
    assert_eq!(
        serde_json::to_value(outcome).expect("serialize outcome")["state"],
        "managed_outdated"
    );
}

#[tokio::test]
async fn github_client_debug_is_secret_free_and_base_urls_are_validated() {
    install_rustls_provider();
    let secret = "ghp_black_box_secret_value";
    let authenticated =
        GitHubClient::new(Some(secret.to_owned()), "https://github.example/api/v3/")
            .expect("construct authenticated client");
    let debug = format!("{authenticated:?}");
    assert!(authenticated.is_authenticated());
    assert!(!debug.contains(secret));
    assert!(!debug.contains("black_box_secret"));
    assert!(debug.contains("authenticated: true"));

    let anonymous =
        GitHubClient::new(None, "https://api.github.com").expect("construct anonymous client");
    assert!(!anonymous.is_authenticated());
    let _backend: &bun_git::octocrab::Octocrab = anonymous.octocrab();

    assert!(GitHubClient::new(None, "not a URL").is_err());
}
