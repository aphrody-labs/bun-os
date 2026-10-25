// SPDX-License-Identifier: Apache-2.0
//! Golden check of the two committed CSS sheets this crate generates.
//!
//! `packages/m3-theme/tokens.css` (fusion palette) and
//! `packages/m3-tokens/src/m3-tokens.css` (shape, typescale, motion, elevation, state) are
//! rendered by `aphrody_m3_tokens::sheets` and must match byte for byte. Rewrite them with
//! `APHRODY_UPDATE_TOKENS=1 scripts/aphrody/build/rust/cargo-serial.sh test -p aphrody-m3-tokens --test
//! sheets_golden`. The formatter pass of `bun run generate` in `@aphrody/m3-theme` is a no-op on
//! this output.

use std::{fs, path::PathBuf};

use aphrody_m3_tokens::{
    scheme::Variant,
    sheets::{BASELINE_SEED, static_css, tokens_css},
};

fn repo_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn check(relative: &str, expected: &str) {
    let path = repo_path(relative);
    if std::env::var_os("APHRODY_UPDATE_TOKENS").is_some() {
        fs::write(&path, expected).unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
        return;
    }
    let actual =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    assert!(
        actual == expected,
        "{relative} is stale; regenerate with APHRODY_UPDATE_TOKENS=1 (see this file's docs)"
    );
}

#[test]
fn fusion_tokens_sheet_is_current() {
    check(
        "packages/m3-theme/tokens.css",
        &tokens_css(BASELINE_SEED, Variant::TonalSpot, 0.0),
    );
}

#[test]
fn static_tokens_sheet_is_current() {
    check("packages/m3-tokens/src/m3-tokens.css", &static_css());
}
