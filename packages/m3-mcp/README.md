<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-mcp

MCP-shaped design/UI tools (packages, M3 tokens, docs, templates, Material Symbols, desktop icons) for a host MCP server; it is not a server itself.

```sh
bun add @aphrody/m3-mcp
```

```ts
import { callM3Tool, listM3Tools } from "@aphrody/m3-mcp";

console.log(listM3Tools().map(tool => tool.name));
const result = await callM3Tool("m3_token_lookup", { query: "primary" });
console.log(result.content[0]?.text);
```

## Data sources

Installed from npm, the tools read their dependencies: tokens from `@aphrody/m3-tokens`, the design and
Replica tools from the `m3-design` CLI of `@aphrody/m3-design`, desktop icons from
`@aphrody/material-design-icons`, OS themes from `@aphrody/m3-os-themes`. Inside a checkout (the nearest
ancestor with `packages/m3-tokens`, or `APHRODY_M3_ROOT`) they read the workspace instead, which also enables
the checkout-only data: `m3_list_packages` lists every workspace package (else this package and its installed
dependencies), `m3_docs_search` and `m3_research_links` read `docs/`, `m3_list_templates` reads
`packages/m3-templates`. `APHRODY_DESIGN_CORPUS` points the docs tools at a design-sync corpus anywhere.
`m3_symbol_svg` and `m3_symbol_search` read the Material Symbols SVG catalogue of
`@aphrody/material-design-icons`, which lives in the checkout's `vendor/material-design-icons` submodule.

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

## Tools

The single `aphrody-mcp` hosts these tools (`aphrody mcp-server`, alias `m3-mcp`). From a checkout:

```sh
bun src/tool-host.ts list                          # tool definitions (JSON)
bun src/tool-host.ts call m3_token_lookup '{"query":"primary"}'  # one MCP-shaped result
```

| Tool                                         | Does                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m3_list_packages`                           | workspace packages with versions (installed dependencies outside a checkout)                                                                                                                            |
| `m3_token_lookup`, `m3_token_validate`       | look up and validate M3 tokens                                                                                                                                                                          |
| `m3_os_themes_list`, `m3_os_themes_generate` | OS theme targets of `@aphrody/m3-os-themes` (dry run)                                                                                                                                                   |
| `m3_docs_search`, `m3_research_links`        | search `docs/`, list research links                                                                                                                                                                     |
| `m3_list_templates`                          | `packages/m3-templates`, `templates/`, `examples/` of a checkout                                                                                                                                        |
| `m3_symbol_svg`, `m3_symbol_search`          | Material Symbols SVG and catalogue search (`@aphrody/material-design-icons`)                                                                                                                            |
| `m3_svg_to_ico`                              | SVG to Tauri desktop icons                                                                                                                                                                              |
| `m3_design_search`                           | BM25 search of the UI/UX Pro Max catalogs of `@aphrody/m3-design` (styles, colours, typography, UX, charts, icons, stacks such as `m3`); `query`, optional `domain` and `stack`, `limit` (1-20), `json` |
| `m3_design_system`                           | full design-system recommendation (pattern, style, colours, typography, effects, anti-patterns) for a product `query`; `projectName`, `format` (`markdown` or `ascii`), `brand`; never writes files     |
| `m3_contrast`                                | WCAG 2.2 contrast of a `tokens` file's text/background pairs (Replica `tokens.json` or W3C tokens), or of one `fg`/`bg` hex pair; `json`                                                                |
| `m3_parity`                                  | feature parity score of a clone from a Replica `matrix` CSV (must/should/could weights), missing features in build order; `visual` folds in `m3_imgdiff --json` outputs; `markdown`, `json`             |
| `m3_imgdiff`                                 | screenshot diff of an `original` and a `clone` PNG: `mode` `layout` ignores colour (rebrand-safe), `pixel` checks regressions; `out` writes a diff PNG; `json`                                          |

The five design tools run `m3-design search|system|contrast|parity|imgdiff` (30 s limit). `m3_contrast`,
`m3_parity` and `m3_imgdiff` start their text with `exit <code>`: for `m3_contrast`, `exit 1` means a pair fails
AA, which is a result, not a tool error; other codes (usage, unreadable input) set `isError`.

Sources: `src/tools.ts` (tool table), `src/tool-host.ts` (`list` / `call`), `src/catalog.ts` (file-backed lookups). Tests:
`bun test`; typecheck: `bun run typecheck`. Registered in the aphrody-labs plugins marketplace as
the `aphrody-m3` plugin.
