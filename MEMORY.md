# Workspace facts

Keep this file to durable ownership and workflow facts. Dated execution results
belong in their source commits or generated qualification receipts, not in a
rolling status narrative.

## Ownership

- `bun-distribution`, branch `os`, is the canonical Bun OS distribution
  workspace. It owns product assembly, workspace configuration, factory,
  packaging and release coordination.
- The runtime is unmodified upstream Bun, npm `bun@1.4.4-canary.20261028.1` (gitHead
  `11c367163a4b`). The `aphrody-labs/bun` fork is abandoned. This workspace
  consumes the runtime through the pin in `package.json`.
- Product members belong under the root `apps/`, `crates/` and `packages/`
  directories. Imported projects retain their upstream history, licenses and
  ownership until a deliberate migration is completed.
- Rose Griffon application source belongs to
  `aphrody-labs/rosegriffon`; integration references are in
  `docs/ROSEGRIFFON.md`.
- The distribution direction is Arch Linux with pacman/libalpm. Server, COSMIC
  Desktop and Gamescope Gaming are separate compositions. Alpine and Ubuntu
  remain compatibility targets. The final goal is Bun integrated into the Linux
  kernel the way Rust was; the phased plan is `docs/KERNEL-ROADMAP.md`.

## Current structural caveats

- Root Bun and Cargo manifests are separate owners and must both agree with
  physical source and ownership inventories.
- The root Cargo workspace does not yet contain every Rust owner. Nested
  workspaces and explicit exclusions are migration boundaries, not evidence
  that Rust consolidation is complete.
- Vendor directories can contain active upstream source, pins and licenses.
  Audit each candidate's references and build inputs before removal.
- Generated inventories and dated verification results can become stale. Read
  their source manifests or receipts before making current-state claims.

## Workflow

- Read `AGENTS.md`, `GOAL.md`, `PLAN.md` and `START-HERE.md` before structural
  changes.
- Use the repository's native Bun commands for Bun quality work and the
  serialized Cargo wrapper for Rust. Run builds and qualification on the VPS.
- Preserve concurrent work and protected data; stage precise owned paths only.
- Fetch and verify ancestry before pushing. Never force-push.
