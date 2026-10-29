> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Security policy

## Reporting a vulnerability

Report vulnerabilities in any Aphrody component privately through GitHub private vulnerability reporting on the
public runtime repository:
[github.com/aphrody-labs/bun/security/advisories/new](https://github.com/aphrody-labs/bun/security/advisories/new).
This covers the runtime, the artifacts published on downloads.aphrody.com and the distribution components; the
distribution repository (aphrody-labs/aphrody) is private and cannot receive reports itself.

Do not report vulnerabilities in public pull requests or discussions. Issues are disabled on aphrody-labs/bun.

A useful report names the component and its version (or the release ID from
[latest.json](https://downloads.aphrody.com/latest.json)), the platform, the steps to reproduce and the impact.

There is no published response-time commitment and no bug bounty.

`contact@aphrody.com` is the commit identity of the project. No mailbox is attached to it
([MAIL-STACK.md](docs/reference/ai/MAIL-STACK.md)), so it is not a reporting channel.

## Supported versions

| Component | Receives fixes |
| --- | --- |
| Distribution artifacts | The release named by `latest.json` on downloads.aphrody.com. Earlier releases stay downloadable under `/releases/<id>/` and are not patched. |
| Runtime (aphrody-labs/bun) | The latest `aphrody-v*` release. |
| `@aphrody/*` npm packages | The latest published version of each package. |

## Verifying downloads

Each distribution release publishes `SHA256SUMS` next to its artifacts, and `latest.json` lists the SHA-256 of every
artifact. `install.sh` and `install.ps1` check every download against the `SHA256SUMS` of the same release before
using it. Runtime releases publish `SHA256SUMS.txt`, which the runtime installers check the same way.

## Upstream code

Several components are forks (Bun, WebKit, rclone, rsync, Tauri and others; see
[aphrody.com/components](https://aphrody.com/components)). A vulnerability that comes from upstream code should also
be reported to the upstream project. The runtime merges upstream `oven-sh/bun` `main`, so an upstream fix reaches it
at the next merge.
