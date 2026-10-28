// Leaf crate on std, gix and octocrab, outside the event loop (like `bun_host`, `bun_ssh`):
// std I/O, std strings and std::process are intended here.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

// SPDX-License-Identifier: Apache-2.0

use bun_git::ingest::{
    DEFAULT_IGNORE_PATTERNS, estimate_tokens, format_token_count,
};

#[test]
fn test_token_estimation_and_formatting() {
    assert_eq!(estimate_tokens(""), 0);
    let sample = "hello world this is a test string";
    let tokens = estimate_tokens(sample);
    assert!(tokens > 0);

    assert_eq!(format_token_count(500), "500");
    assert_eq!(format_token_count(1500), "1.5k");
    assert_eq!(format_token_count(2_400_000), "2.4M");
}

#[test]
fn test_default_ignore_patterns_coverage() {
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&".git"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"node_modules"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"target"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"*.pyc"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"Cargo.lock"));
}
