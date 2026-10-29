<!-- SPDX-License-Identifier: Apache-2.0 -->
# GitHub ownership

State verified on 2026-10-01 with `gh api`. Owner directives: every repository
is private during development, no AI app or bot is installed on any repository
or organization, and nothing is published without an owner decision
([CLAUDE.md](../../CLAUDE.md)).

## Accounts and organizations

| Login | Role |
| --- | --- |
| `aphrody-dev` | Human owner account; owner of `aphrody-labs`. Its SSH key (`~/.ssh/github_aphrody_dev`, alias `github-dev`) is the Git transport for `aphrody-labs` through `url.insteadOf`. |
| `aphrody-code` | Legacy account and commit identity (`aphrody-code <contact@aphrody.com>`); member of `aphrody-labs`. Keeps personal projects, upstream mirrors and archived repositories. |
| `aphrody-labs` | Organization for **production and build repositories only, with no duplicate** (owner decisions, 2026-10-01): a source lives in exactly one repository. |

Both accounts are logged in with `gh` on WSL, vps and dbfr. Scripts select one
explicitly with `gh auth token --user <login>`; MCP servers use the same
helper. No token value belongs in a repository.

## `aphrody-labs` repositories

| Repository | Why it is there |
| --- | --- |
| `aphrody` | Canonical monorepo (Rust + Bun), all Aphrody domains, the plugin and the Codex marketplace (`.agents/plugins/marketplace.json` (not in repo)). |
| `aphrody-py` | Python workspace (training, RAG kernels), cloned next to the monorepo by the bootstrap. |
| `iecode` | IEVR/NIE workspace; consumes `@aphrody/*` through the sha256 archive channel (`yolo ops aphrody-packages prepare`, pinned in its `config/aphrody-packages.json` (not in repo)). Absorbs the former `nie`, `iepy` and `iecode-cpp` repositories. |
| `oxc` | Fork pinned as a Cargo git dependency in `Cargo.toml`. |
| `bun` | Bun fork (`config/bun-fork.json` (not in repo)), keeps its `oven-sh/bun` fork relationship. |

Deleted on 2026-10-01 (verified: the organization lists only `aphrody`, `aphrody-py`, `bun`, `iecode`, `oxc`) after a verified mirror, bundle and metadata backup
(`~/.aphrody/private/backups/github/aphrody-labs-2026-10-01/`, 15 GB;
the former Windows and remote copies were removed after SHA-256 verification
on 2026-10-02 under the single-copy rule): the former split layer
repositories `aphrody-ai`, `-os`, `-ui`, `-web`, `-compat`, `-contracts`,
`-shell`, `-native`, `-infra`, `-discord`, `-koharu`, `-src`, `-go`, `-ts`,
`aphrody-legacy`, and `bxc`, `fut`, `n2b`, `winclean`, `nie`, `iepy`,
`iecode-cpp`, `diffutils`, `findutils`, `grep`, `sed`, `tar`. Their content
lives in the monorepo or in IECODE. An organization owner can restore a deleted
repository for 90 days from the organization settings.

`dot-aphrody` (the `~/.aphrody` agent-profile repository) moved back to
`aphrody-code/dot-aphrody`: it is live configuration, not production.

## Rules for changes

- A new repository goes to `aphrody-labs` only if a production service or a
  build depends on it and its content exists nowhere else in the organization;
  otherwise it stays under `aphrody-code`. Imported sources are never kept as
  a second repository next to the monorepo.
- Transfer instead of re-creating: GitHub redirects old URLs (Git included)
  until a repository is created at the old location, so never reuse an old
  name. Update `origin` remotes, `config/*.json` and references in one commit.
- Before deleting a repository: `git clone --mirror`, `git bundle create --all`
  and `git bundle verify`, export issues and releases, record SHA-256 sums and
  retain one verified set on WSL under [ADR D12](../../decisions/infra/sql-convergence.md).
  Do not create a second backup on Windows, vps or dbfr.
- Inspect the current Actions run instead of assuming a historical billing
  failure still applies. RG run `36934495176` executed and failed on the retired
  Zukan documentation import; the successor `36935223127` for `d7feb4c5d`
  is being qualified. A running workflow is not a successful release gate.
