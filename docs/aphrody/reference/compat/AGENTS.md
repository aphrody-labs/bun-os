> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-compat: agent rules

Owns toolchain discovery and offline Bun documentation, and consumes the published N2B crates.
`aphrody-bun` / `@aphrody/bun` now belong to UI.
Follow [workspace rules](../workspace/AGENTS.md) and the user's global policy:
**NHITL**, no approval prompts or interactive questions for authorized work.

## Boundaries

- No AI dependency. Contracts owns report schemas and the subsystem contract;
  resolve sibling paths from manifests, never copy their implementations.
- Use Bun and workspace dependency/lint inheritance. Preserve Windows/Linux support.
- `test/fixture/` is deliberately Node-flavoured input; do not normalize it.
- Read [README](../../products/compat/README.md) and the [docs index](../../products/compat/_source/README.md) for working entry points.

## n2b

n2b and the Oxc bridge moved to the Bun fork (`aphrody-labs/bun/packages/bun-n2b`, `aphrody-labs/bun/packages/bun-oxc`); see
[N2B.md](./N2B.md). Their frozen CLI, exit-code, report-schema and rule-ID contract is documented and
tested there. Aphrody consumes the published `aphrody-n2b*` crates at an exact version.

## Validation

Documentation: links/anchors and `git diff --check`. Implementation: focused checks,
then these gates with the pinned toolchain and `RUSTC_WRAPPER=`:

```sh
export RUSTC_WRAPPER=
cargo fmt --check
cargo check  --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test   --workspace
cargo deny   check
bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test
git diff --check
```

## Automatisation transversale

`bun run docs:bun:update` délègue à `yolo ops bun-upstream-docs` l'épinglage du commit des docs Bun du fork (pas de copie). Conserver cette entrée locale lors de toute évolution du module central.
