> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Next.js + Vercel Rust crates

## Déplacé vers aphrody-labs/bun

Cette cartographie (crates `next-*`, `turbo-tasks*`, `turbopack*`) est reprise et mise à jour pour Next.js
16.5.0-canary.4 dans le fork Bun : [packages/bun-next/docs/PLAN.md](https://github.com/aphrody-labs/bun/blob/main/packages/bun-next/docs/PLAN.md), section « Next.js and Turbopack crates ».
Conclusion conservée : ne pas lier Turbopack dans un workspace Cargo ; la pièce utile est
`next-custom-transforms`, candidate à un plugin natif `onBeforeParse` de Bun.
