> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# creator.aphrody.com: creator-kit download and auto-update

Owner order of 2026-10-06: a minimal Material 3 page with one download button and automatic updates for
`packages/product`. Static site, no application origin: nginx serves the `current` release tree.

| Path                           | Content                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                            | page (Aphrody M3 tokens, Google Sans Flex, MAKIT logo and favicons), built by `packages/product/resources/creator/site/build.ts`                             |
| `/download/windows`            | current Windows pack (`.zip`, stable name, never cached)                                                                              |
| `/latest.json`                 | manifest read by the page and by `creator-kit self-update`: `version`, `artifacts[]` (`kind` pack or update, `url`, `sha256`, `size`) |
| `/SHA256SUMS`, `/files/<file>` | checksums and immutable versioned archives                                                                                            |

Public and unauthenticated by design (published, checksummed release files only; GET and HEAD only).

## Publish

Builds run on the vps (cross-compiled Windows exe, rcedit under Wine), from a checkout of this repository there:

```sh
bun scripts/aphrody/release/publish-creator.ts plan --host local
bun scripts/aphrody/release/publish-creator.ts stage --host local     # build into build/creator, publish nothing
bun scripts/aphrody/release/publish-creator.ts release --host local   # build, scan, publish, sha256sum -c, flip `current`
bun scripts/aphrody/release/publish-creator.ts verify                 # public download and SHA-256 of every artifact
bun scripts/aphrody/release/publish-creator.ts host-apply --apply --host local   # release root and vhost
```

`--host <ssh-alias>` publishes to the vps over OpenSSH instead (default `vps`).

A canary Bun cannot download its `bun-windows-x64-baseline` runtime: run the publisher with the
`bun-linux-x64` of an aphrody-labs/bun release and pass the `bun-windows-x64.exe` of the same release with
`--compile-executable-path` (checked against its `SHA256SUMS.txt`). Release 1.4.7 (2026-10-23) was built with
the `main-runtime-633fd8a28f47` pair.

Bump `version` in `packages/product/package.json` before a release: the updater installs a release only
when its version is newer. The exe is compiled with `bun build --compile --target=bun-windows-x64`; its icon and
version resources are set with the pinned rcedit (SHA-256 in the script) under Wine because `--windows-icon` only
works when compiling on Windows. `release` refuses a pack that holds a denied file name or a token-shaped string.

## Auto-update

The compiled exe checks `latest.json` at most every 12 h at start (4 s timeout, never blocking) and, when a newer
version exists, a detached `self-update --quiet` downloads the flat `update` archive, verifies SHA-256 and size,
extracts it next to the exe and swaps it in (the running exe is renamed to `.old`, removed at the next start). It
takes effect at the next launch. `CREATOR_KIT_NO_UPDATE=1` disables it; `creator-kit self-update [--check]` runs it by
hand. A `bun` source run never replaces itself.

## Host

- DNS: `creator.aphrody.com` proxied by Cloudflare to the vps.
- TLS: `/etc/letsencrypt/live/aphrody.com` (its SAN covers `creator.aphrody.com`).
- vhost `infra/config/host/nginx/aphrody/creator.aphrody.com.conf`, installed as
  `/etc/nginx/conf.d/creator.aphrody.com.conf` of the vps host nginx; catalog service `aphrody-creator`
  (`nginx-static`), route in `infra/config/host/nginx/routes.json`. Releases in `/home/ubuntu/apps/creator/releases/<id>`, last five kept.
- Rollback: repoint the `current` symlink to an older release, or remove the vhost and reload nginx.
