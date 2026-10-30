# Aphrody / Bun control plane

Aphrody Infra owns hosts, services, routes and lifecycle. Komodo is the Rust
deployment actuator. Source lives on GitHub (`aphrody-labs/bun-os`, branch
`main`) and is used with plain `git`; there is no self-hosted forge and no
self-hosted CI runner (retired 2026-10-30, see [SYNC.md](SYNC.md)). CI is
`.github/workflows/`; builds and qualification run on the VPS.
The existing Infra catalogs remain the single desired-state source.

## Placement

All control services use the qualified VPS under its configured `~/apps`
layout. One `aphrody` Compose project includes `komodo` and `webos`. Existing
workloads and protected stores remain independently owned. No local Windows
build or WSL is part of this deployment.

| Capability | Loopback port | Domain |
| --- | --- | --- |
| Deployment | 29021 | deploy.aphrody.app |
| Product API (staged) | 29030 | source.aphrody.app/api/product/v1/ |

The `app-*.aphrody.app` and capability-alias custom domains are handled by the
`aphrody-webos` Cloudflare Worker (`apps/webos/wrangler.jsonc`). The apex
`aphrody.com` and `www` are DNS-only and served by the native Bun WebOS service
on the VPS through Nginx. `craft.aphrody.app` has its own VPS Nginx frontend.

Application slots stay staged, without a container or systemd unit, until a
verified native artifact qualifies. Their initial ingress returns 503.
Cloudflare owns public DNS and shared R2; Workspace owns immutable assets
through its CAS/S3 adapter. The artifact package owns native extraction and
artifact manifests.

## Authentication and persistence

Komodo creates the configured admin from a mounted password file. Local and
OIDC registration are disabled. MongoDB is private; JWT, webhook and database
credentials remain mounted files in `~/.aphrody/secrets/control`. Persist Core
and Periphery keys. Initialize and verify both admins before enabling ingress.

Komodo 2.3.3 and MongoDB 8.0.32 use version and registry digest pins in their
canonical Compose sources. Runtime databases live under each app's protected
data tree. Credentials stay in `~/.aphrody/secrets/control` (directory 0700,
files 0600). The MongoDB password file is 0640 with container group 999.

MongoDB 8.0.32 uses its [official Linux rseq configuration](https://github.com/mongodb/mongo/blob/r8.0.32/buildscripts/resmokeconfig/suites/rseq_kernel_check.yml):
`GLIBC_TUNABLES=glibc.pthread.rseq=1`.

## Canonical repository and builds

The canonical repository is `aphrody-labs/bun-os` on GitHub, branch `main`
(the only integration branch). Heavy builds run on the VPS checkout
`~/src/bun-os`, never on the Windows workstation.

## Deployment ownership

`infra/apps.json` is Bun OS's distribution app-build and asset inventory. It
declares target inputs, native package requirements, source revisions and
content-addressed asset roots. It is not a host-service or deployment catalog.
Library capability IDs and application hostnames come from the local
`@aphrody/bun-workspace` package.

Bun OS Infra owns host services, Compose profiles, application routes and
standalone app activation through the imported native implementation in
`crates/aphrody-infra`. The root `infra/config/host/` catalog owns desired state.

The root product server has a standalone staging candidate; see
[product server](PRODUCT-SERVER.md). Infra reserves loopback port 29030 and
`/api/product/v1/` for the product API. The service and ingress remain inactive
until activation is approved.
