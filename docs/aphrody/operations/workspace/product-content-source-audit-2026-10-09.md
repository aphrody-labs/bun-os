> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Public product content source audit — 2026-10-09

## Source selection and revisions

Native owner workflow `bun packages/infra/workspace/src/bun-upstream-docs.ts --resolve --no-download`
resolved the existing Bun checkout documentation at `C:\bun\docs`. No research clone was created.
Native Git fetched the existing `origin main` remotes for both repositories:

| Source | Fetched main and local HEAD |
| --- | --- |
| Aphrody | `568eeffc5f1cd5cfeb23cc73952b082aa3a213e2` |
| Bun fork | `73fdb3e193bc765c7a0150008078ee484166de8f` |

These are dated source observations, not permanent current-main claims. The selected fork is
`aphrody-labs/bun`; `oven-sh/bun` remains the fork's upstream remote.

The owner documentation check reported a stale pin `57752e1611cdbccfaa0825902390e9ad973a5e24`.
`bun run docs:bun:update` changed `SOURCE.json` to
`1a3f3dc4d332bee7b1fae6dc1cc46e995c9f46bc`; `bun run docs:bun:check` then passed.
The pin selects the latest commit affecting `docs/`, excluding `docs/aphrody` (not in repo) work plans.
The plain `git log -- docs` head `c6654dfe852ea78c68b86a323774ffa5719031a4` includes work-plan
changes and is therefore not the owner workflow's documentation pin.

## Documentation producers

- Bun API documentation is the fork's MDX corpus and `docs/docs.json` (not in repo) navigation. Aphrody reads it
  in place and stores its revision and licence, rather than copying the documentation tree.
- `scripts/aphrody/mcp-docs.ts` (not in repo) in the fork generates the marked tool table in
  `docs/runtime/mcp.mdx` (not in repo) from the actual `bun mcp tools --markdown` executable output. This audit
  did not regenerate that table or qualify a different Bun executable.
- `scripts/aphrody/graph-docs.ts` (not in repo) exports bounded graph-based documentation artifacts with source
  hashes. Its `published: false` metadata is not proof of public website publication.
- Aphrody's product articles are its own embedded JSON catalogue:
  `crates/web/site/data/docs.json`, loaded by `crates/web/site/src/docs.rs` and shared through
  `/api/docs` and the product adapters. They are not generated Bun API documentation.

## Corrected product articles

All five identifiers and categories remain stable to preserve existing links and API consumers.
Titles, summaries, tags and article bodies now describe the current product owners, with source
links and a review date. Private repository links require authorized access.

| Identifier | Removed stale claim or reference | Current source |
| --- | --- | --- |
| `runtime-architecture` | YOLO as a separate runtime owner and retired implementation path | Root PLAN, `packages/engine/runtime`, `crates/interop/ffi/include/aphrody.h` |
| `bun-native-framework` | `apps/web/build.ts` as current frontend; unqualified fork/toolchain claims | `m3/packages/app-ui`, `m3/packages/m3-next`, fork docs |
| `material-3-design-tokens` | Retired `apps/web/src/core/theme.ts`; blanket contrast assurance | `m3/packages/m3-tokens/src/dynamic-color.ts`; rendered accessibility checks |
| `tauri-desktop-bridge` | Missing Tauri frontend configuration and old ping bridge | `crates/ui/app/tauri.conf.json`, CEF manifest, shared `tauri-bridge.ts` |
| `llms-txt-standard` | Assertion that the product does not serve `/llms.txt` | Root guidance and live public `/llms.txt` |

The original TS migration hash remains in `docs.rs` as historical provenance. It no longer
claims that the edited catalogue preserves those bytes verbatim. No licence or notice was removed.

## Live boundary

Native HTTPS probes against `aphrody.com` observed:

| URL | HTTP result |
| --- | --- |
| `/api/docs` | 404, HTML |
| `/docs/runtime-architecture` | 404, HTML |
| `/llms.txt` | 200, plain-text Aphrody overview |

The two 404 responses demonstrate that source availability is not deployment activation.
This audit rewrites source content and refreshes its documentation pin; it does not claim a
deployed catalogue, search ranking increase, measured Web Vitals improvement or physical desktop
qualification. Deployment and public route checks belong to the native site release batch.
