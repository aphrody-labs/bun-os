<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody AI documentation

Start with the [product README](../README.md) and the
[active monorepo plan](../../../PLAN.md). Rust and Bun owners now share
this checkout; Python remains in `../aphrody-py` and game implementation
in `../iecode`. The separate `aphrody-ui` checkout belongs to its
designated agent. The [imported UI contract](../../../../m3/docs/reference/GUI.md)
does not prove current runtime behavior.

The [imported AI delivery plan](../../../plans/ai/PLAN.md) retains its domain
requirements and historical baseline. Execute and qualify them through the root
plan; its old repository paths and status claims require current evidence.

## Navigation and evidence

| Question | Authority |
| --- | --- |
| What ships next, and what proves it works? | [Root plan](../../../PLAN.md), imported [AI requirements](../../../plans/ai/PLAN.md#delivery-sequence), [release acceptance](../../../plans/ai/PLAN.md#release-acceptance) |
| What exists, and what is still unverified? | [Current baseline](../../../plans/ai/PLAN.md#current-baseline), [SOURCE_OF_TRUTH.md](../../../reference/ai/SOURCE_OF_TRUTH.md) |
| How do the native UI, agent and workers connect? | [ARCHITECTURE.md](../../../architecture/ai/ARCHITECTURE.md) |
| Which repository owns a capability? | [Organization and ownership](../../../plans/ai/PLAN.md#organization-and-ownership), [generated ecosystem inventory](../../../ecosystem/ECOSYSTEM.md) |
| What does each capability contribute to the product? | [Capability integration](../../../plans/ai/PLAN.md#capability-integration) |
| What does responsive mean? | [Latency budgets](../../../plans/ai/PLAN.md#latency-budgets) |
| How are changes maintained and checked? | [DOCUMENTATION-PIPELINE.md](../../../reference/ai/DOCUMENTATION-PIPELINE.md), [agent rules](../../../reference/ai/AGENTS.md) |

## Working guides

- Setup and operation: [INSTALL.md](../../../guides/ai/INSTALL.md), [CLI.md](../../../reference/ai/CLI.md),
  [config.md](../../../reference/ai/config.md), [agent-console.md](../../../reference/ai/agent-console.md),
  [TROUBLESHOOTING.md](../../../reference/ai/TROUBLESHOOTING.md), [PITFALLS.md](../../../reference/ai/PITFALLS.md).
- Engine and extensions: [agent-stack](../agent-stack/README.md),
  [MCP.md](../../../reference/ai/MCP.md), [MCP_SETUP.md](../../../guides/ai/MCP_SETUP.md),
  [AGENT-SKILLS-PLUGINS-SPEC.md](../../../reference/ai/AGENT-SKILLS-PLUGINS-SPEC.md),
  [computer-use.md](../../../reference/ai/computer-use.md).
- Models and knowledge: [LOCAL-AI-MODELS.md](../../../reference/ai/LOCAL-AI-MODELS.md),
  [RAG.md](../../../reference/ai/RAG.md), [training.md](../../../reference/ai/training.md),
  [Google](../google/README.md), [Grok](../grok/README.md).
- Delivery and provenance: [GIT-GITHUB.md](../../../reference/ai/GIT-GITHUB.md),
  [cargo](../cargo/README.md), [RELEASE-CHECKLIST.md](../../../operations/ai/RELEASE-CHECKLIST.md),
  [THIRD_PARTY_CODEX.md](../../../reference/ai/THIRD_PARTY_CODEX.md),
  [SECURITY-MODEL.md](../../../research/ai/SECURITY-MODEL.md), [PRIVACY.md](../../../reference/ai/PRIVACY.md).

Executable examples must be checked against current command help and source.
A guide or a generated crate description does not prove runtime readiness.

## Historical evidence

The original imported index
is preserved byte for byte. Its relative links retain the historical base
`docs/products/ai/_source/`; it is a snapshot rather than navigation to repair.
Domain guides below retain their original scope and may contain old paths.

Dated audit snapshots removed from the working tree remain available at the
[2026-09-28 cleanup parent revision](https://github.com/aphrody-labs/aphrody/tree/51c8502949c420b9c8d4945fef0a63dcf2aaea33/docs/audits);
the research files still in this tree retain their original scope.
The [2026-09-26 protocol and desktop fact-check](../../../apis/ai/research/agent-protocol-and-desktop-factcheck-2026-09-26.md)
and [Rust parity assessment](../../../research/ai/research/codex-rust-parity-2026-09-26.md) are
historical observations, not current product certification.
The former [P0-P11 plan](../../../plans/ai/plans/codex-oss.md) retains a provenance link and its
referenced audit anchor. Other imported roadmaps, visions and comparisons
retain their domain context; the root plan governs current execution.

The dated [Koharu AI capability map](https://github.com/aphrody-labs/aphrody/blob/51c8502949c420b9c8d4945fef0a63dcf2aaea33/docs/audits/2026-09-27-koharu-ai-capability-map.md)
compares source-level manga OCR, translation, inpainting, model runtime and
agent capabilities with existing Aphrody AI owners. It is an inventory
snapshot, not a delivery plan or parity claim.

Older material can name repositories or paths that moved during the category
split. Resolve ownership through the current architecture and infra inventory
before using an old command, dependency or service name.

## Generated documentation

`SUMMARY.md`, `llms.txt` and `docs/_root/` (not in repo) mirrors are owned by
`aphrody-summary`; regenerate them rather than editing them by hand.
The generator includes historical Markdown in its context output, so each
historical page must state its scope. Read current authorities before dated
results. Current workspace inventory belongs to [Infra/Workspace](../../../../../packages/workspace/).
Imported ecosystem inventories describe their dated source state and do not
prove current ownership or service health.
