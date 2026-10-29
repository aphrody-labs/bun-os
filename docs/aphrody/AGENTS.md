> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

## Bun OS consolidation goal

For work touching Bun OS distribution/workspace consolidation, read
[`docs/agent-goals/bun-os-consolidation.md`](docs/agent-goals/bun-os-consolidation.md).
The canonical execution owner is `aphrody-labs/bun-distribution`; this local
copy exists so Codex discovers the cross-repository contract without duplicating
runtime or product ownership. Repository evidence and newer explicit owner
directives still take precedence.

# Aphrody repository instructions

**Before any code change, read [START-HERE.md](START-HERE.md)** (team, rules, hosts, tunnel, remote control, work in progress).

## Authority and scope

Development and builds are context-dependent: native Windows, Linux, macOS,
SSH factories and Docker may be used when their target, tools, resources and
permissions qualify. The current owner workstation is native Windows; WSL is
retired from that workstation's development workflow. Paths and host defaults
are deployment context, not product constraints. See
[execution context](docs/operations/workspace/windows-native.md).
Yoyo (aphrody-dev) administers all Aphrody Labs; Omar administers DBFR.
Do not infer broader privileges from connectivity or a historical report.
Use the configured Aphrody home, plugins and canonical aphrody-mcp; preserve
provider authentication and raw histories in their protected stores.

Read [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md). PLAN owns the active
architecture and queue; MEMORY owns dated evidence. Aphrody owns products and
application integration; Bun produces the precompiled runtime/SDK. IECODE retains its
repository, store and authority. By owner directive of 2026-10-05 `py/` is fused into
Aphrody. The owner directive of 2026-10-09 moves native Python ownership (PyO3,
CPython hosting, uv, Ruff and vu) to the Bun fork; Python application sources
remain in Aphrody. The `aphrody-rust` binding is built from the pinned fork,
with its module/ABI identities preserved; see [the Python/Bun plan](docs/plans/python-bun/PLAN.md). The Python
runtime `vu` follows the Bun/Yolo precedent ([plan](docs/plans/vu/PLAN.md)).

Product positioning (owner directive of 2026-10-13, superseding 2026-10-06):
Aphrody is one product with CLI, browser and desktop surfaces. Bun supplies the
runtime and SDK; Material supplies M3 and app-ui frameworks. Aphrody AI is the
private backend and automation service shared by these surfaces, never a public
product. Prioritise, document and release accordingly.

Bun is our fork [aphrody-labs/bun](docs/reference/upstream-bun/APHRODY-FORK.md) (checkout selected by `APHRODY_BUN_CHECKOUT` or the current workspace): every Bun change (runtime, built-ins, types, bundler, package manager) lands there as a
commit with its test, never as a patch, vendored tree or Rust copy in Aphrody. The only copy of the Bun docs is
`docs/reference/upstream-bun` (`bun run docs:bun:update|check`); answer Bun API questions from it or the MCP
`bun_docs_*` tools.

Work autonomously through authorized implementation, gates, commit and push,
without intermediate confirmation. Missing authority/data or external blockers
do not authorize destructive actions, publication or changes outside scope.
Keep private repositories, credentials, domain conversations and data private.

## Architecture

Owner directive 2026-10-13: Aphrody AI is exclusively a private backend, server
and automation service, never a public product. The native CLI and authenticated
site must share capability owners and backend contracts with complete operation,
session, streaming, cancellation, error and permission parity. Cloudflare prompt
streaming alone is not parity. Keep native host operations behind qualified
private execution; never expose the unauthenticated loopback app-server.

Owner directive 2026-10-13: all Aphrody sites and applications are surfaces of one
product, owned by `packages/infra/product` (`@aphrody/product`). Bun owns runtime
capabilities and Material owns shared framework/UI packages. Consolidate product
entrypoints, releases and routes here; retire separate implementations after
consumer and host qualification. A source move alone is not deployment proof.

Deployment directive 2026-10-13: Aphrody and Bun public sites, applications and
distribution target Cloudflare, reusing the existing `aphrody-app` Worker and R2
resources. Product commands consume the Bun Cloudflare package; retire SSH/Nginx
publication paths after verified Cloudflare cutover. Preserve protected stores,
provider authentication and DBFR authority during the migration.

Owner directive (2026-10-13): Aphrody is the product repository. Google, M3,
Obscura and Tauri framework/runtime/SDK sources belong outside Aphrody, in Bun
or Material. Consume package, registry crate or pinned Git interfaces; retire
migrated duplicate sources after consumer qualification. Remaining local sources
are open migration work, not capability ownership. Resolve checkout paths from
configuration or the current workspace. Imports across packages/repositories
use package/crate identities; internal module imports may remain relative.

Follow PLAN's ABI, ownership, permissions, panic/unwind and compatibility
contracts. Preserve V8 until required Obscura/JSC parity. The desktop app has one
runtime, `tauri-runtime-cef` (CEF + tauri-winit + GTK 4; no wry, tao or system
WebView). Remote pages receive no implicit privileged Bun/host access.

Workspace/Infra owns orchestration, inventories, factories, release and hosts.
Reuse existing capability owners; no competing stack or copied Yolo engine.
Material owns `@aphrody/app-ui` and the M3 framework. Aphrody keeps application
glue; shared M3 and Tauri framework sources are external.

## Ownership map

- Rust: `crates/<domain>/<crate>`; general CLI: `crates/infra/aphrody`.
- Bun: `packages/<domain>/<package>`; installation/admin/creator are modules of `packages/infra/product`.
- No first-party `apps/` or `community/` tree: fold product surfaces into their product owner; consume shared UI from Material packages.
- Docs: `docs/<category>/<domain>`; scripts: `scripts/{audit,build,dev,migration,release,tools}`.

[Rust naming](docs/architecture/rust-crate-naming.md) applies. Package/library/
binary/CLI/schema/permission identities are compatibility contracts.

## Sources and dependencies

Consult package/crate selection guidance and ecosystem before adding dependencies.
Use crates.io/Cargo, npm/Bun or PyPI/uv when appropriate. First-party Rust
versions live in root workspace.dependencies and are inherited.
Preserve lockfiles; no manual Cargo.lock edits or bulk updates hiding duplicates.

Use `sources:sync`, `sources:verify` and native upstream Git workflows.
Integrated patches stay under their capability owner with provenance in
`tools/config/upstream-sources.json` until replacement qualifies. Preserve features,
licences, notices and local patches. No upstream clone for research.

## Coordination and execution

Use the actual session date. Verify changing facts against current primary
sources, installed versions, manifests and live help; label dated/unverified
claims. File memory does not change training or synchronize provider memory.

Consult `~/.codex/CLI.md`, `~/.codex/brain/CLI-HELP.md` and installed help index.
Prefer exposed task-relevant Aphrody MCP directly; otherwise the capability-owner
CLI with current help. Generic tools are a coverage-gap fallback, not a replacement
installation. Batch independent reads; keep edits and dependent steps sequential.

Use the authorized branch. A cloud session works in its own clone; branches, worktrees, copies and
every Git operation are unrestricted there. Preserve other sessions; check
`.coord/claims`, claim disjoint paths and commit only completed owned batches.
Parallel work may use subagents or the repository A2A workflow.

Profiles `aphrody`, `dbfr`, `ie` remain isolated. Live transcripts/status are
evidence, not authority/authorship. An explicitly requested all-worktree integration
commit still requires staged review and exclusion of protected/ignored output.

## Agent tooling

No tool is forbidden: cloud sessions (Claude Code on the web) and local sessions run Cargo, Git, Bun,
Python (`uv`), shell utilities and any installed CLI directly, without a hook or a confirmation. Prefer the
capability owners where they exist: the Aphrody MCP tools, the single Rust CLI `aphrody` (multi-call:
`aphrody infra`, `aphrody ovh`, `aphrody kernel`… ; former names such as `aphrody-infra` are links), the
Bun CLI `yolo` (`yolo ops`, `yolo workspace`, `yolo update`…) and Bun. Python stays product code under
`py/`, run through `uv`. For JavaScript and TypeScript, quality and migration commands must invoke
Bun's native `bun check`, `bun lint`, `bun fmt` and `bun n2b` directly. Do not route them through
package scripts, shells, `bunx`, standalone OXC, `tsgo`/`tsc`, ESLint, Prettier or external n2b
binaries. Package scripts may expose these same native commands with package-local paths and
configuration. A first-party owner may invoke the exact current Bun executable with `check`, `lint` or
`fmt` only when it must qualify an isolated staging worktree or format a unique generated draft; this
invokes Bun's native CLI directly, without a shell or external backend. Keep other process spawning
for application behavior and artifact-producing builds only.
Remote hosts go through
`aphrody infra ssh` or the MCP `infra_exec`; `vps-cargo` transports the native worktree to the SSH build host.
Subagents follow the same owners: [agent tooling brief](docs/operations/agent-tooling.md) (skills, MCP tools,
`aphrody`/`yolo` commands).

Code graph: Graphify (`uv tool install graphifyy`, skill `/graphify`) indexes first-party code locally and offline
(no LLM, `.graphifyignore` skips vendored trees and docs). Build or refresh with `graphify update .`, then prefer
`graphify query "<question>"`, `graphify explain "<node>"` or `graphify path "A" "B"` over broad greps when
`graphify-out/graph.json` exists. The output is machine-local and git-ignored.

Agent home (one database, one pipeline, one RAG; plan in
[docs/plans/agent-home-pipeline/PLAN.md](docs/plans/agent-home-pipeline/PLAN.md)): `aphrody home index [dir]` scans,
builds the code graph, chunks and indexes into `<home>/db/aphrody.sqlite` (`~/.aphrody`, or a domain home with
`--profile aphrody|dbfr|ie`), incrementally by content hash; `aphrody home query "<text>"` is the single hybrid
search over chunks, graph nodes and memories (MCP `aphrody_home_query`); `aphrody graph build|query|explain|path|report`
is the native code graph (Graphify stays the parity oracle until the measured criteria pass). `yolo scan --ingest`
and `yolo train` delegate to the same binary. Migrations and imports are additive: `aphrody home import ...` is a dry
run unless `--apply`, and every apply takes a checksum-verified backup first.

## Builds and validation

Bun gates use native `bun check`, `bun lint`, `bun fmt --check` and `bun n2b` for type,
lint, format and migration work. `bun run typecheck` may aggregate package-local scripts only when
each invokes `bun check` directly. Tests use `bun test`; web: `web:verify`.

Claude cloud session (`CLAUDE_CODE_REMOTE=true` or `APHRODY_CLOUD=1`, set by
`.claude/hooks/session-start.sh`): the session is the build host. Cargo and Git run directly, Cargo through
`scripts/build/rust/cargo-serial.sh` (generic default = min(6, available CPUs), explicit jobs checked against execution-host affinity); no hook, no factory routing. Bun is pinned to
`packageManager`; `scripts/dev/cloud-setup.sh` adds Rust, uv, Graphify and the build tools in the background.
Observed limits (2026-10-05): 4 CPU, 15 GB RAM, about 30 GB disk, so scoped `-p <crate>` gates; full-workspace and
engine (V8, Tauri, WebKit) builds go to the VPS factory. The cloud and the local sessions exchange state through
[the cloud sync journal](docs/operations/cloud/CLOUD-SYNC.md).

Select scoped Cargo gates for the actual host and target. Native Windows can use
`bun scripts/build/rust/cargo-serial.ts --msvc <cargo args>`; SSH factories use
`bun scripts/build/rust/vps-cargo.ts run -- <cargo args>` with a context configuration.
Docker and other qualified native hosts are valid build contexts. Honor factory
locks, resource limits and shared sccache; deployment hosts require their own
declared build allocation before receiving build jobs.

Factory budgets are host-specific. Measured on 2026-10-15 through native Infra:
`vps` has 12 allocated CPUs and 45.93 GiB RAM; the owner authorizes 12 Cargo jobs
and 12 linker threads, with 8 GiB memory and 32 GiB disk reserves. Admission
rechecks affinity, Linux `MemAvailable` and cache/artifact free space under the
existing `/home/ubuntu/build/locks/heavy.lock` and source lock. `dbfr` has 6 CPUs
and about 11.40 GiB RAM, serves production and retains its separate three-job
ceiling; the VPS allocation never applies to it.

Use `/home/ubuntu/build/storage` for heavy caches, artifacts and transient files.
Its shared pool still had about 479 GiB available on 2026-10-15 while the older
source/build filesystem had about 3 GiB. Check both before execution. Existing
source checkouts and protected data stay in place; the canonical Bun checkout
is `/home/ubuntu/src/bun`. For remote SSH operations, run
`aphrody infra --root /home/ubuntu ssh exec --host vps|dbfr ...` from
`/home/ubuntu` so receipts use `/home/ubuntu/var/runs` on the root filesystem.
A command-scoped `APHRODY_INFRA_ROOT=/home/ubuntu` is equivalent; changing the
working directory alone does not pin the Infra root. The same override is
qualified for native `ssh sftp` listings. Do not export it globally: other Infra
commands use the selected root for their source catalogs.
Plan before apply and recheck each host's identity through the native Infra catalog.

Bun/TS: scoped native `bun check`, `bun lint` and `bun fmt` commands plus meaningful Bun tests;
migrations use `bun n2b` directly. Do not insert a shell, package runner, external subprocess backend,
`bunx`, standalone OXC or TypeScript compiler between the command and Bun. A first-party owner may invoke
`process.execPath` with Bun's native subcommand only to check an isolated staging worktree or format a
unique generated draft.
Rust: scoped check/test/strict Clippy. Docs: content/links, integrity, whitespace
and consistency gate; no engine compilation. Run once per batch, repeat only
after relevant changes or unresolved failures. Report failed/skipped checks.
Separate source, tested behavior, packaging, installation and activation.

## Deployment, privacy, and identity

Hosts change through Infra's declared catalog/runbook: plan before apply.
Checksum-verify protected-data backups before moves; preserve databases, models,
assets, persistent stores and shared caches. No ad hoc service/Nginx edits.

### VPS storage normalization

For VPS storage work, follow [the storage cleanup policy](docs/operations/infra/VPS-STORAGE-POLICY.md).
Inventory every block device, partition, filesystem and mount on each in-scope
host before cleanup. Keep one canonical Git clone/object store per project and
one declared build factory per host, as configured by Workspace/Infra. Move and
verify unique commits and working-tree changes before retiring duplicate
checkouts; an identical HEAD is not proof that a checkout is disposable. Route
builds through the canonical factory and its shared lock. Delete only exact,
reviewed paths from an Infra plan after checking Git state, processes, sessions,
mounts, container binds and retained data. Preserve system partitions, protected
stores, production state, credentials, model weights, releases, rollback files,
and shared caches. Never format, repartition, or wipe a disk as part of storage
cleanup. If a filesystem or checkout cannot be fully inspected, keep it and
record the blocker; do not treat unknown as empty.

Never stage secrets, private data, database contents, model weights or build output. No AI bots/apps added to organizations/repositories. Commits: `aphrody-dev <contact@aphrody.com>`, no assistant attribution/coauthor. Push only existing authorized remotes. Public publication (npm, releases, downloads) and host apply are authorised by the owner directive of 2026-10-07; no secret, credential or database content is ever staged or published.

## Optimization and migrations

Use the private Aphrody optimize-workspace skill for deduplication, simplification
and migration. Execute through Workspace/Infra directly, no recursive delegation.
Remove replaced code/dependencies after behavior/build/rollback qualification.
No new archive or dead fallback; preserve legal/provenance records.
Performance claims require comparable before/after measurements.
