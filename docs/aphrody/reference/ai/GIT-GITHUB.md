<!-- SPDX-License-Identifier: Apache-2.0 -->
# Git and GitHub integration

[`aphrody-git`](../../../crates/infra/git/src/lib.rs) is the native Git/GitHub
layer used by the `aphrody git` CLI. Local inspection uses pure-Rust `gix`;
GitHub REST and GraphQL use `octocrab`. The crate is currently
`publish = false`, so consumers must pin the Git repository itself.

## Native CLI surface

Inspect any directory or file inside a worktree, or a bare repository, without
spawning `git`:

```console
aphrody git inspect . --pretty
aphrody git inspect Cargo.toml --pretty
```

The JSON snapshot contains canonical `root` and `git_dir` paths, branch and
HEAD state, remotes, and index/worktree changes. Each changed path has a display
string plus `path_bytes_base64`, which preserves non-UTF-8 Unix path bytes.
GitHub inference checks both fetch and push URLs, prefers `origin`, and supports
`GITHUB_HOST` or `GITHUB_SERVER_URL` for an Enterprise host.

Fetch repository metadata from an explicit `owner/name` or supported GitHub
HTTPS/SSH URL, or infer it from the local repository:

```console
aphrody git repo aphrody-code/aphrody --pretty
aphrody git repo --path . --pretty
```

The generic REST gateway accepts `GET`, `POST`, `PATCH`, `PUT`, and `DELETE`.
Only `GET` executes without `--apply`; every other method emits a JSON plan:

```console
aphrody git api /repos/aphrody-code/aphrody/actions/runs --pretty
aphrody git api --method POST /repos/aphrody-code/aphrody/actions/workflows/ci.yml/dispatches \
  --body '{"ref":"main"}'
aphrody git api --method POST /repos/aphrody-code/aphrody/actions/workflows/ci.yml/dispatches \
  --body '{"ref":"main"}' --apply
```

The body may be inline JSON or `@path/to/body.json`. Responses retain the HTTP
status; an empty successful response, including HTTP 204, has a JSON `null`
body. Routes must be relative paths beginning with one `/`, or absolute HTTPS
URLs under the configured API origin and base path. Cross-origin,
scheme-relative, and Enterprise base-path escapes are rejected.

GraphQL also accepts inline JSON or `@file.json`:

```console
aphrody git graphql '{"query":"{ viewer { login } }"}' --pretty
```

If the query contains a `mutation` token, or no query text is available, the
CLI emits a plan and requires `--apply`. The check is deliberately
conservative; it is not a full GraphQL parser.

Authentication is runtime-only. `GH_TOKEN` takes precedence over
`GITHUB_TOKEN`. `GITHUB_API_URL` selects the REST base and
`GITHUB_GRAPHQL_URL` may select a same-origin URL ending in `/graphql`;
otherwise the GraphQL URL is derived for GitHub.com or Enterprise. Anonymous
public reads remain possible. Tokens are not serialized or included in the
client's debug representation.

## Immutable source contract

The CLI defaults `--source-ref` to `main` for compatibility, and local render
or audit accepts any validated Git ref. The migration policy is stricter:
always pass the full 40-character SHA of a reviewed Aphrody commit. Remote
`rollout --apply` enforces that requirement and rejects branches, tags, and
abbreviated SHAs.

The source commit must already be pushed and must contain the reusable workflow
and action before any consumer commit is created. Verify that precondition with
the native API:

```powershell
$sourceSha = git rev-parse HEAD
if ($sourceSha -notmatch '^[0-9a-fA-F]{40}$') { throw 'invalid source SHA' }
aphrody git api "/repos/aphrody-code/aphrody/commits/$sourceSha" --pretty
```

Pin Rust consumers the same way:

```toml
[dependencies]
aphrody-git = { git = "https://github.com/aphrody-code/aphrody", rev = "FULL_40_CHARACTER_APHRODY_COMMIT_SHA" }
```

The crate exports `inspect_repository`, `GitHubClient`, its REST and GraphQL
gateways, repository normalization types, and the managed workflow audit,
render, install, and rollout functions.

## Managed caller and local installation

The reusable workflow at `.github/workflows/aphrody-reusable-ci.yml` (not in repo) is
consumed through one generated workflow file containing this shape:

```yaml
# SPDX-License-Identifier: Apache-2.0
# Managed by aphrody-git.
name: Aphrody ecosystem CI

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  aphrody:
    uses: aphrody-code/aphrody-infra/.github/workflows/aphrody-reusable-ci.yml@FULL_40_CHARACTER_APHRODY_COMMIT_SHA
```

Do not copy the placeholder literally; the installer substitutes the supplied
ref. Local installation requires each argument to be a repository root with a
`.git` entry. Plan first, then apply the same immutable source SHA:

```powershell
aphrody git install ..\n2b --source-ref $sourceSha --pretty
aphrody git install ..\n2b --source-ref $sourceSha --apply --pretty
```

Plan mode writes nothing. Apply is idempotent, rejects invalid or
YAML-injectable refs, refuses any existing file without the managed marker, and
rejects existing symbolic-link components in the managed path. A marked file
is fully owned by Aphrody and may be replaced to restore the canonical caller;
put repository-specific configuration in another workflow.

## Organization-wide audit and rollout

The owner defaults to `aphrody-code`. The implementation detects whether the
owner is an organization or user, paginates its repositories, and selects
repositories whose owner matches and whose `archived` flag is false. Forks are
excluded unless `--include-forks` is supplied. With authentication, a user
audit uses owner-affiliated repositories and can include private repositories
allowed by the token; anonymous discovery is limited to public repositories.

An omitted `--repository` means every eligible repository, including the
source repository itself. Repeated `--repository NAME` flags create an exact
allow-list. An invalid, unavailable, archived, or otherwise ineligible
requested name fails preflight before repository writes begin.

Run the read-only coverage audit and rollout plan with the same source SHA:

```powershell
aphrody git audit aphrody-code --source-ref $sourceSha --pretty
aphrody git rollout aphrody-code --source-ref $sourceSha --pretty
aphrody git rollout aphrody-code --repository n2b --source-ref $sourceSha --pretty
```

Apply to a pilot, then to the full eligible owner only after the reports are
acceptable:

```powershell
aphrody git rollout aphrody-code --repository n2b --source-ref $sourceSha --apply --pretty
aphrody git rollout aphrody-code --source-ref $sourceSha --apply --pretty
```

Remote apply uses GitHub's Contents API and commits directly to each default
branch with `chore: adopt Aphrody ecosystem CI`. It creates a missing managed
caller or updates one containing the marker. It does not overwrite unmanaged
content, initialize empty repositories, create branches or pull requests,
dispatch CI, or wait for workflow results. After global preflight succeeds,
per-repository API/decoding failures are recorded as `error` outcomes and do
not stop later repositories.

Before the first write, apply verifies that both the reusable workflow and the
composite toolkit action exist at the exact source SHA. A repository whose
workflow is absent is additionally probed for a default-branch commit, so a
genuinely empty repository is reported as `empty_repository` instead of being
initialized accidentally.

The audit is a caller-coverage audit, not a production-readiness audit. The
reusable workflow performs bounded recursive discovery for Rust, Bun, Python,
.NET, CMake, and Codex/Claude plugin surfaces while excluding generated and
cache directories. It runs Rust, Bun, Python, plugin, and optional custom jobs
on `ubuntu-24.04`; .NET and C++ are detected but opt-in because a generic Linux
gate is not safe for every repository. Windows/macOS jobs remain repository-
specific. Disabled surfaces are not scanned, directory inputs narrow each scan,
matrices are capped at 64 roots per surface, Bun and Python require their native
lockfiles, and command,
toolchain, and version inputs allow explicit overrides. The canonical generated
caller intentionally passes no inputs and therefore uses these conservative
defaults.

## Shared scripts through the composite action

The composite action `.github/actions/aphrody-toolkit/action.yml` (not in repo) of the source
repository `aphrody-code/aphrody-infra` (not of this category repository) exposes
the checked-out Aphrody action root as output `root` and appends its
`scripts/` directory to `GITHUB_PATH`. A consumer workflow must first check out
its own repository, then invoke the toolkit at the same immutable source SHA:

```yaml
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
  - id: aphrody
    uses: aphrody-code/aphrody-infra/.github/actions/aphrody-toolkit@FULL_40_CHARACTER_APHRODY_COMMIT_SHA
  - run: scan-repo.sh
```

The Aphrody reference is immutable in this migration, and every third-party
action used by the reusable workflow is pinned to a full commit SHA. The
toolkit action verifies its canonical root plus `scripts/audit/ai/scripts/scan-repo.sh`, exposes
`root`, `scripts`, and `scan-repo` outputs, and adds only the verified scripts
directory to `PATH`.

## Safety and honest delivery

The native result state is evidence, not a claim that a repository's CI is
healthy:

| Native result | Honest-delivery classification |
| --- | --- |
| `current`, with `written: true` and a returned commit SHA | **FAIT** for caller rollout; the commit is the artifact. |
| Existing `current` found by audit | **FAIT** for coverage only; no new delivery occurred. |
| `missing` or `managed_outdated` in audit/plan | **INCOMPLET**; apply has not produced the requested artifact. |
| `unmanaged`, `empty_repository`, or `error` | **NON_FAIT** for that repository; report the preserved file, empty default branch, or diagnostic as the blocker. |

A plan can be **FAIT** as an audit artifact but must never be reported as a
completed rollout. Classify every repository independently when a batch has
mixed outcomes, following the repository's
[`AGENTS.md` honest-delivery contract](./AGENTS.md#3-honest-delivery).

Local apply performs confinement and symlink checks around a direct filesystem
write; it is not an atomic no-follow replacement. Use it only against a trusted
checkout that is not being concurrently modified. Remote apply is a direct
default-branch mutation and therefore requires explicit `--apply`, an immutable
source SHA, and token permissions appropriate for workflow content.

The machine-readable counterpart, `aphrody-ecosystem.toml`, lives at the root
of the source repository `aphrody-code/aphrody`.

The measured 2026-09-07 migration, including every consumer commit and the
remaining external blockers, is recorded in the
[historical multi-agent Git/GitHub migration audit](https://github.com/aphrody-labs/aphrody/blob/51c8502949c420b9c8d4945fef0a63dcf2aaea33/docs/audits/2026-09-07-multi-agent-git-github-migration.md).
