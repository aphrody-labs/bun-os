> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Release Checklist

Per-release maintainer checklist for `aphrody`. Run through every section
before tagging and pushing a release (§5). Items here are the
human-judgement steps that automation cannot substitute for.

Copy this checklist into the release tracking issue (or PR description)
and tick boxes as you go.

## 1. Pre-flight (T-24h)

- [ ] All open security advisories triaged
      (`gh api repos/aphrody-code/aphrody/security-advisories` or GitHub UI).
- [ ] All Dependabot PRs reviewed; deny-list (per
      `dependabot.yml`) intact.
- [ ] All in-flight Discussions answered or moved to issues.
- [ ] [`docs/PLAN.md` (not in repo)](../../plans/ai/PLAN.md) reviewed; all `Pending` items
      either shipped or explicitly punted.
- [ ] [(upstream oxc doc, not vendored)](../../plans/ai/ROADMAP.md) reflects current quarter targets.
- [ ] [`docs/reference/ai/FAQ.md`](../../reference/ai/FAQ.md) covers new features in this release.

## 2. Test gates (run locally)

- [ ] `cargo check --workspace --all-targets --locked --offline` exit 0
- [ ] `cargo clippy --workspace --all-targets --locked --offline -- -D warnings` exit 0
- [ ] `cargo nextest run --workspace --locked --offline` 100 percent pass
- [ ] `cargo deny check` advisories, bans, licenses, sources all ok
- [ ] `cargo machete --with-metadata` no unused deps
- [ ] `cargo vet --locked` no formatting errors (unvetted backlog acceptable)
- [ ] `cargo bench --workspace --no-run` exit 0
- [ ] `cargo doc --workspace --no-deps --locked` exit 0
- [ ] Cross-target: `cargo check -p aphrody --target wasm32-unknown-unknown --locked` exit 0
- [ ] WASM: `bun scripts/build/rust/wasm-package.ts --crate <crate> --out <dir>` (cargo, then `bun:wasm` of the aphrody-labs/bun fork: wasm-bindgen, wasm-opt -Oz, size ratchet) produces the package

## 3. Docs sync

- [ ] [`CHANGELOG.md`](../../reference/ai/CHANGELOG.md) Unreleased section reflects all
      merged work since last tag (preview with
      `git log <last-tag>..HEAD --oneline`).
- [ ] [`docs/reference/ai/SUMMARY.md`](../../reference/ai/SUMMARY.md) regenerated
      (`aphrody summary`).
- [ ] All cross-links resolve (manual spot-check on
      [`README.md`](../../products/ai/README.md), [`PLAN.md`](../../plans/ai/PLAN.md), [`docs/README.md`](../../products/ai/_source/README.md)).
- [ ] No `_pending_` markers for features being released in this version.

## 4. Version bump

- [ ] `Cargo.toml [workspace.package].version` matches the planned release version.
- [ ] Versions are bumped by hand (no release-please since the split, see
      [`docs/operations/ai/CI-CD.md`](./CI-CD.md#releases)); sibling path dependencies carry matching `version`s.
- [ ] Per-crate `version.workspace = true` everywhere (no per-crate overrides).
- [ ] All `publish = true` crates have a `description`, `license`,
      `homepage`, `repository`, `keywords`, and `categories` set.

## 5. Tag and push

- [ ] Build + install the Linux release binaries with `scripts/tools/ai/scripts/deploy.sh`,
      then smoke-test `aphrody --version` / `aphrody doctor` on supported targets.
- [ ] Create the local commit and annotated tag
      (`git tag -a v<version> -m "v<version>"`).
- [ ] Inspect the local diff (`git show v<version>`) before pushing.
- [ ] Push: `git push origin main && git push origin v<version>`
      (the first `v*` tag is human-gated — cf. CLAUDE.md §0.1).

## 6. Post-tag

- [ ] Build the per-target `aphrody` binaries through the `aphrody-infra` release plane (the
      monolith `release.yml` / `release-please.yml` workflows were removed with the split) and
      attach them to the GitHub Release of the tag: the `aphrody` CLI is distributed through
      GitHub Releases, not crates.io.
- [ ] Verify the GitHub Release page lists all expected artefacts
      (binaries per OS/arch, SBOM, checksums, source tarball).
- [ ] If the library release set changed: follow
      [`docs/reference/ai/cargo/PUBLISH-LADDER.md`](../../reference/ai/cargo/PUBLISH-LADDER.md)
      (21 crates from `aphrody-contracts`, `aphrody-native` and `aphrody-compat`, 6 rungs in
      order; no `aphrody-ai` crate is published).
- [ ] Update Homebrew tap, Scoop bucket, AUR, and any other downstream
      package manifests with the new SHA-256 sums.

## 7. Announce (Show HN, Lobste.rs, etc.)

For `v1.0.0` stable, run a Show HN launch; canary and minor releases typically skip the full
launch flow and post only to the project Discussions board).

## 8. Rollback plan

If a release breaks production for users:

- Yank the affected library crates from crates.io: `cargo yank --version <version> <name>`
  (per [`docs/reference/ai/cargo/PUBLISH-LADDER.md`](../../reference/ai/cargo/PUBLISH-LADDER.md) section 7).
- Revert the offending commit on `main`; tag `v<version>.1` patch with
  the fix.
- DO NOT delete the tag or release on GitHub (history immutability).
- Open a post-mortem issue tagged `release-rollback` documenting the
  failure mode and the gate that should have caught it; feed the
  finding back into section 2 of this checklist.

## 9. Sign-off

Maintainer initials and ISO-8601 date:

```
[ ] aphrody-code  2026-??-??
```

Archive the completed checklist (with ticked boxes) as a comment on the
release tracking issue so future audits can reconstruct which gates
were green at tag time.
