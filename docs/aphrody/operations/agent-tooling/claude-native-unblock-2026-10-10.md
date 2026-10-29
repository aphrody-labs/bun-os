> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Claude native fork and MCP qualification, 2026-10-10

Owner request: unblock Claude through the configured Aphrody skills and canonical
MCP, preserving concurrent Bun, npm, WASM and host work.

## Runtime and capabilities

The official `aphrody-labs/bun` release `aphrody-v1.4.3-aphrody.4` contains the
Windows x64 archive and SHA256SUMS.txt. The existing repository installer
`scripts/tools/bun-hygiene.ts` verified that archive's digest and its executable
version before swapping the PATH binary. Native `bun --revision` now returns
`1.4.3-aphrody.4+41211b568`; owned bunx/node/npm/npx aliases were relinked. Running
publishers retained their previous mapped executable and were not restarted.
No Bun checkout or npm version manifest was changed by this batch.

Contrary to the previous handoff, the published `.4` binary imports
`bun:windows` successfully and reports `isSupported: true`. Read-only calls to
`systemInfo()` and `storage.drives()` succeed; only key names and drive count
were observed, with no private values recorded. Registry, services, storage and
Win32 helpers are exported. This is not complete windex migration qualification.

The exact windex families `kernel32`, `advapi32` and `wintrust` fail before
binding their symbols because their `@aphrody/bun-windows-*` family packages are
not installed in the selected consumer. The kernel32 registry metadata exists
(`latest: 71.0.30-preview`). No dependency was added to a concurrent consumer.
`bun:icons` is unavailable. A future runtime release alone does not prove these
family packages are installed or windex behavior is equivalent.

The existing runtime resolver incorrectly accepted installed
`1.4.3-aphrody.3` against exact pin `1.4.3-aphrody.4`. The toolchains owner now
preserves exact fork/prerelease identity, ignoring build metadata, while retaining
ordinary numeric prefix and minimum version behavior. Native MSVC serialized
check, strict Clippy and all nine tests pass. Commit: `15243e252d`.

## Claude skills and protocol

The configured Aphrody plugin 2.3.0 is enabled and advertises the canonical
`plugin:aphrody:aphrody` connection. Bun docs and Infra tools are permitted by
the current local filter. Their CLI MCP calls succeed. The new repository skill
`fork-runtime-routing` loads through Claude's actual Skill tool; it gives exact
version checks and capability-owner routes without adding another server.

An actual Claude tool call revealed a stronger failure than the connection
indicator: `tools/call` results lack the mandatory `resultType` discriminator
under protocol `2026-07-28`. This reproduced with the installed binary, an
existing newer debug binary, and a fresh build before the fix. A metadata-only
wire probe proved that Claude supplies the modern protocol metadata and receives
valid modern discovery/list results, but rejects the tool result. Raw provider
sessions stay in Claude's isolated store; the probe retains only request method,
protocol metadata and response key names in the protected qualification cache.

The server fix normalizes completed results once after dispatch, covering native
routers and relayed owners. It fills the discriminator on legacy-shaped owner
JSON; the SDK still strips it for legacy peers. Regression coverage includes
modern and legacy wire shapes and a real stateless Bun docs tool call.

Native serialized server gates pass: 12 protocol tests (including legacy and
error results), four client smoke tests with a real stateless Bun docs call,
scoped check and strict all-targets Clippy. The native CLI was rebuilt and staged
alone, avoiding installation of unrelated debug siblings. The unnecessary
explicit identity lifetime added concurrently was removed to restore strict
Clippy. Server fix commit: `0375ce75de`.

After the owner install dry-run, `aphrody self install --no-boot --keep-legacy`
installed the qualified binary and canonical aliases. Binary SHA-256:
`135b46a90b6929219d69eb335e14dc2dfbead00c598dda972264f5d2fa234405`.
The existing plugin's single `aphrody` server entry now targets the canonical
per-user `bin/aphrody-mcp.exe` (not in repo); its elevation launcher, profile and isolated model
environment remain intact. The installed catalog reports 440 tools. Only the
specific `runtime_resolve` deny entry was removed after live qualification of
the fixed resolver: old retained Bun `.3` gives `satisfies_pin: false`, installed
Bun `.4` gives `true` against exact `.4`. Other permission filters are preserved.

Protected owner/SYSTEM backup copies and SHA-256 ledgers retain the prior plugin
configuration, Claude settings, canonical executable and release metadata.
No provider was forcibly restarted and no host boot apply was performed. Raw
Claude sessions, credentials and cookies remain in their isolated stores.

Actual Claude invocation using the permanent default plugin configuration,
without a temporary strict MCP config, returned `SKILL_MCP_PASS` with zero
permission denials. Its isolated session metadata proves calls to Skill
`fork-runtime-routing`, plugin `bun_docs_search`, `runtime_resolve` and
`infra_exec` (`vps`, `true`). Session identifier:
`60c65eec-e0e2-42f4-8bdd-04edb03beb4c`. Native `aphrody home --profile aphrody status`
also reads the selected isolated store successfully; home/graph remain CLI-owned
routes when the current MCP catalog lacks their tools.

The installed executable is a qualified debug artifact built from the shared
working tree, with concurrent dirty inputs recorded in a protected source ledger.
Its installed release metadata explicitly says `dirty: true`; this is not a clean
published release or proof of every CLI capability. Existing client connections
retain their original process; newly started Claude sessions use the fixed entry.
Container publication, npm publication and full windex migration remain separate
owner deliveries; this receipt does not claim their completion.
