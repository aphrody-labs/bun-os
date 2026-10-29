<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Discord Architecture & Upstream Consolidation

> [!NOTE]
> Canonical documentation for Discord architecture and standalone native compilation is located at:
> - [**Aphrody Discord Architecture**](../README.md)

This directory preserves historical audits and records the completion of the Discord architecture consolidation in the Aphrody monorepo.

---

## 1. Audited Upstreams Status

| Repository or bot | Historical Audit | Current Status (October 2026) |
| --- | --- | --- |
| **Aphrody AI messaging** | [aphrody-ai-messaging-discord.md](./upstreams/aphrody-ai-messaging-discord.md) | Fully ported and active as `@aphrody/discord-kit/messaging` (`packages/discord/kit/src/messaging.ts`). Zero-runtime-dependency REST channel transport. |
| **NIE Wunderbot** | [nie-wunderbot.md](https://github.com/aphrody-labs/iecode/blob/main/docs/nie/nie-wunderbot.md) | Historical upstream review; superseded by shared framework. |

---

## 2. Consolidation Completion Status (October 1, 2026)

All six phases of the original consolidation plan have been **fully achieved**:

1. **Shared contracts:** Stabilized in `@aphrody/discord-kit/messaging` (platform-neutral channel contracts, 9 unit tests passing, tsdown build).
2. **One Discord runtime (`@aphrody/discord-kit`):** Centralized in `packages/discord/kit` with intent preflight checks (`resolveGrantedIntents`), production cache limits and sweepers (`createProductionCacheOptions`), resilient interaction error recovery (`safeExecuteInteraction`), and runtime detection (`isCompiledBinary`).
3. **Elimination of upstream forks:** The legacy nested fork `upstream/discord` (3.9 GB, 2,232 files) was entirely deleted. Dependencies are resolved strictly via npm catalog entries (`workspaces.catalog`) in the root `package.json` under **Bun 1.4.2** and **TypeScript 7.0.2**.
4. **App migration:** the Discord bot applications now consume `@aphrody/discord-kit` and catalog dependencies.
5. **Standalone Native Compiler:** `crates/infra/aphrody-command/src/discord_cmd.rs` provides native compilation (`aphrody discord compile all --smoke`) producing self-contained native binaries.
6. **Release & verification gate:** `bun run discord:verify --compile` runs catalog verification, kit unit tests, messaging unit tests, bot test suites and standalone binary smoke tests with 100% pass rate.
