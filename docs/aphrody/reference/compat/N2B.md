> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# n2b and the Oxc bridge

n2b (the Node.js to Bun analyzer and codemod) and the Oxc bridge live in the Bun fork
[aphrody-labs/bun](https://github.com/aphrody-labs/bun). Their sources, rule registry, tests and
documentation are maintained there.

| Product    | Fork path                                                                                                                                                                           | crates.io                                                                      | npm                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| n2b        | [`aphrody-labs/bun/packages/bun-n2b`](https://github.com/aphrody-labs/bun/tree/main/packages/bun-n2b) ([docs](https://github.com/aphrody-labs/bun/tree/main/packages/bun-n2b/docs)) | `aphrody-n2b`, `aphrody-n2b-core`, `aphrody-n2b-registry`, `aphrody-n2b-types` | `@aphrody/bun-plugin-n2b` |
| Oxc bridge | [`aphrody-labs/bun/packages/bun-oxc`](https://github.com/aphrody-labs/bun/tree/main/packages/bun-oxc) ([docs](https://github.com/aphrody-labs/bun/tree/main/packages/bun-oxc/docs)) | `aphrody-oxc-bridge`                                                           | `@aphrody/bun-plugin-oxc` |

Aphrody consumes the published crates at an exact version. `aphrody n2b` and the `n2b` MCP tool run
the same analyzer as `bunx @aphrody/bun-plugin-n2b`.

The fork documents the CLI, the `n2b.json` manifest, the rule registry, the JSON report schema v2 and
the crate architecture. The Node.js API reference is
[nodejs.org/api](https://nodejs.org/api/), and the Bun page is
[docs/runtime/nodejs-compat.mdx](https://github.com/aphrody-labs/bun/blob/main/docs/runtime/nodejs-compat.mdx) of the fork.
