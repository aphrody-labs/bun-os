<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workspace documentation

> Historical source-workspace index. Current navigation is generated in
> [docs/README.md](../../README.md); use the
> [documentation controller](../../guides/workspace/documentation.md) and
> [agent index](../../llms.txt) for the active monorepo.

The root records cross-repository boundaries and routes work to its owner.
Repository internals, operational runbooks and product acceptance remain in their
own repositories.

## Current authorities

| Question                                                              | Start here                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How is the workspace organized?                                       | [Architecture](../../architecture/workspace/ARCHITECTURE.md)                                                                                                                   |
| How will FFI, Rust/Bun and Python be consolidated under aphrody-labs? | [Root consolidation plan](../../plans/workspace/PLAN.md)                                                                                                                       |
| How is Spacedrive absorbed across Aphrody repositories?               | [Workspace migration plan](../../plans/workspace/PLAN.md)                                                                                                                      |
| How are NIE capabilities absorbed without another repository?         | [Workspace convergence plan](../../plans/workspace/PLAN.md#nie-convergence), [capability map](https://github.com/aphrody-labs/iecode/blob/main/docs/nie/NIE-CAPABILITY-MAP.md) |
| Where are Files/VFS/search duplicates recorded?                       | [Dated Files surface audit](../../research/workspace/FILE-SURFACE-AUDIT.md)                                                                                                    |
| How is Nushell configured on the Aphrody workstation?                 | [Nushell setup](./nu.md)                                                                                                                                                       |
| Which execution rules apply?                                          | [AGENTS.md](./AGENTS.md), the shared execution contract                                                                                                                        |
| What must the workstation deliver next?                               | [AI delivery plan](../../plans/ai/PLAN.md)                                                                                                                                     |
| How does Bun model training cross repositories?                       | [Workspace Bun handoffs](../../plans/workspace/PLAN.md#bun-adapter-handoffs), then the [AI training runbook](../ai/training.md#bun-qwen3-coder-30b-adapter-delivery)           |
| How do the UI and native capabilities connect?                        | [GUI contract](../../../m3/docs/reference/GUI.md), [UI design](../../../m3/docs/architecture/UI-DESIGN.md), [UX design](../../../m3/docs/architecture/UX-DESIGN.md)            |
| Which crates, packages, commands and tools exist?                     | Infra [ecosystem](../../ecosystem/ECOSYSTEM.md), [CLI](../../ecosystem/CLI.md), [MCP](../../ecosystem/MCP-TOOLS.md)                                                            |
| What is the protocol/data ownership?                                  | [Architecture contracts](../../architecture/workspace/ARCHITECTURE.md#contracts-and-data-ownership), then the implementation owner                                             |
| Where are service topology and release decisions?                     | [Infra documentation](../../products/infra/README.md) and its `config/` / `inventory/`                                                                                         |
| Which child revisions are recorded?                                   | Root gitlinks, .gitmodules, manifest and current child Git state                                                                                                               |

## Repository entry points

| Owner                          | Documentation                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI                             | [README](../../products/ai/_source/README.md.a7d252bc425b), [index](../../products/ai/_source/README.md), [architecture](../../architecture/ai/ARCHITECTURE.md) |
| System                         | [README](../../products/os/_source/README.md.712b5622bf2b)                                                                                                      |
| UI                             | [README](../../../m3/docs/products/_source/README.md.8c1fe132fe5c), [index](../../../m3/docs/products/_source/README.md)                                        |
| Manga, OCR and databook review | Aphrody manga adapter                                                                                                                  |
| Web                            | [README](../../products/web/README.md)                                                                                                                          |
| Contracts                      | [README](../../products/contracts/README.md), [A2A](../../products/contracts/a2a/README.md)                                                                     |
| Native                         | [README](../../products/native/README.md)                                                                                                                       |
| Shell                          | [README](../../products/shell/README.md)                                                                                                                        |
| Compatibility                  | [README](../../products/compat/README.md)                                                                                                                       |
| Infrastructure                 | [README](../../products/infra/README.md), [shared integration context](../infra/UNIFIED-AGENT-CONTEXT.md)                                                       |
| Discord integration            | [aphrody-discord](../../products/discord/README.md)                                                                                           |
| NIE                            | README                                                                                                                                                          |
| IECODE                         | README                                                                                                                                                          |

## Historical material

The 2026-09-26 consolidation replaces the former root `architecture/`,
`governance/` and `contracts/` document sets with [ARCHITECTURE.md](../../architecture/workspace/ARCHITECTURE.md)
and owner links. It removes duplicated inventories, superseded migration plans,
rejected single-process proposals and dated migration/snapshot assertions
from current navigation. The duplicate root catalogue generator is replaced by
the existing Infra generator.

The complete previous files, including unresolved observations and third-party
notes, remain in Git at `c2c8494`. For example:

```sh
git show c2c8494:docs/governance/OPEN-RESERVATIONS.md
git show c2c8494:docs/architecture/CARGO-MONOREPO-GUIDE.md
```

Removing a historical observation does not mark its underlying issue fixed.
Current work is tracked in the owning repository and the workstation delivery
plan; old performance numbers, service state and library versions are not current
evidence. Before reusing an old observation, confirm its owner and present source.

Keep one authority per topic. Do not recreate the former root catalogues or copy
infrastructure tables into documentation. New cross-repository decisions extend
the architecture; implementation instructions extend their existing owner.
