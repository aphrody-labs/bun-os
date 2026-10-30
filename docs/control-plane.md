# Aphrody / Bun control plane

Aphrody Infra owns hosts, services, routes and lifecycle. Komodo is the Rust
deployment actuator; Gitea owns Git hosting and its runner owns CI execution.
The existing Infra catalogs remain the single desired-state source.

## Placement

All control services use the qualified VPS under its configured `~/apps`
layout. One `aphrody` Compose project includes `gitea`, `komodo` and
`gitea-runner`. Existing workloads and protected stores remain independently
owned. No local Windows build or WSL is part of this deployment.

| Capability | Loopback port | Domain |
| --- | --- | --- |
| Git forge | 29020 | source.aphrody.app (canonical); git.aphrody.app (legacy alias) |
| Deployment | 29021 | deploy.aphrody.app |
| Git SSH | 29022 | Private tunnel only |
| Product API (staged) | 29030 | source.aphrody.app/api/product/v1/ |

The `app-*.aphrody.app` and capability-alias custom domains are handled by the
`aphrody-webos` Cloudflare Worker (`apps/webos/wrangler.jsonc`). The apex
`aphrody.com` and `www` are DNS-only and served by the native Bun WebOS service
on the VPS through Nginx. `craft.aphrody.app` has its own VPS Nginx frontend.

The Gitea vhost uses a Cloudflare Origin CA certificate for
`source.aphrody.app` and `git.aphrody.app`, issued from a CSR generated on the
VPS. Its private key stays in the VPS protected secret directory. Cloudflare
proxies the public hostnames with Full (strict); the Origin CA certificate is
for Cloudflare-to-origin TLS and is not browser-trusted for direct origin
access. The shared `aphrody-control` certificate remains assigned to the
unrelated app and deployment vhosts.

This table describes canonical reservations. Application slots stay staged,
without a container or systemd unit, until a verified native artifact qualifies.
Their initial ingress returns 503. Cloudflare owns public DNS and shared R2;
Workspace owns immutable assets through its CAS/S3 adapter. The artifact
package owns native extraction and artifact manifests.

## Authentication and persistence

Gitea installation is locked and signup is disabled. Anonymous visitors can
browse and clone public upstream mirrors; private repositories remain
inaccessible anonymously, including through repository API and archive/clone
endpoints. New repositories default to private. The canonical web, API and SSH
URL is `source.aphrody.app`; `git.aphrody.app` remains a compatible HTTPS alias
to the same Gitea instance and repository data. Administrative API operations
remain authenticated. Create the first admin through the native CLI on the
private origin with a random password captured directly into the protected
secret store.

Komodo creates the configured admin from a mounted password file. Local and
OIDC registration are disabled. MongoDB is private; JWT, webhook and database
credentials remain mounted files in `~/.aphrody/secrets/control`. Persist Core
and Periphery keys. Initialize and verify both admins before enabling ingress.

Gitea 28.1.0, Runner 5.0.0, Komodo 2.3.3 and MongoDB 8.0.32 use version and
registry digest pins in their canonical Compose sources. Runtime databases,
repositories and runner registration live under each app's protected data tree.

## Canonical repository

Bun OS is self-hosted: the canonical repository is `aphrody-dev/bun-os` on
`source.aphrody.app` (SSH `git@bun-forge:aphrody-dev/bun-os.git` through the VPS jump host,
pinned ED25519 host key `SHA256:M48ORSUT/TU1sYsWPunaXwQliH0bUVRviGx7m4gWOAs`). `main` is the
default branch and `os` the integration branch; workstations use the forge as `origin`. The
former GitHub repository `aphrody-labs/bun-distribution` and its Gitea pull mirror are no longer
written to.

Heavy builds run on the VPS: the `aphrody-bun-linux` runner job container gets 4 CPUs, 12 GiB and
a persistent `/cache` volume (`~/build/cache/gitea-runner`) for the Cargo home and target, and
`.gitea/workflows/bun-engine.yaml` builds the native engine and runs its machines on free
content on every engine change.

## CI contract

Use `builtin:checkout` and explicit Bun commands. Stock JavaScript actions
dispatch to Node and are outside this Bun-only workflow. Keep GitHub origins
and histories; mirror into Gitea without rewriting commits.

The runner accepts one trusted job with a finite timeout and bounded CPU,
memory and logs. Its pinned existing build image receives the qualified native
Linux Bun binary at `/usr/local/bin/bun` as a read-only mount, with
`BUN_EXECUTABLE` set to that path. Jobs use the `aphrody-bun-linux` label.
Runner and Gitea allow at most 720 minutes per job; capacity stays one, with
two CPUs and 8 GiB per job. Library and SDK mirror Actions stay disabled. The
root mirror admits manual source qualification; its factory workflow remains
disabled until native host admission is ready. Native builds additionally
require an explicit dispatch input. Linux and Windows runtime
revisions and artifacts retain separate qualification.

## Qualification

Observed on 2026-10-13:

- Canonical Infra validation: 59 services, 36 routes; Compose configuration valid.
- Gitea 28.1.0 and Komodo 2.3.3 admins authenticated on private origins before ingress.
- Periphery 2.3.3 connected with persisted, explicitly pinned SPKI keys; server state `Ok`.
- Runner 5.0.0 registered and online with the `aphrody-bun-linux` label.
- A 16-domain TLS certificate is valid until 2027-01-11, with scheduled renewal.
- Windows HTTPS probes: Git login and Komodo 200, Git installer 404, staged video 503.

MongoDB 8.0.32 uses its [official Linux rseq configuration](https://github.com/mongodb/mongo/blob/r8.0.32/buildscripts/resmokeconfig/suites/rseq_kernel_check.yml):
`GLIBC_TUNABLES=glibc.pthread.rseq=1`. This selects per-thread allocation on the
VPS Linux 7.0 kernel and retains MongoDB's compatibility guard.

Credentials stay in `~/.aphrody/secrets/control` (directory 0700, files 0600).
The MongoDB password file is 0640 with container group 999 so its unprivileged
process can read the exact mount; the host parent directory stays private.
Runner registration is a private 0600 file in its 0700 data directory.

The [historical CI receipt](../infra/control/qualification.json) records
pre-consolidation Gitea [run 5](https://git.aphrody.app/aphrody-labs/bun-libraries/actions/runs/5)
from the former Bun Libraries repository. It records source qualification at
`c742e3a50f6880897f2aa55135b2986188f230f0`; it does not establish current CI
ownership or qualification for Bun OS.
In that run, native types checked 57 files; runtime identity matched the Linux
pin, frozen installation, lint, formatting and the application plan passed. No
native builds or tests ran. Checkout initialized configured first-level
submodules. Only the qualified Bun file was allowed as a read-only host mount;
its directory was selected through `GITHUB_PATH` before the remaining gates.

The historical receipt covers an initial set of 18 private mirrors. The
current Infra mirror catalog inventories all 239 Aphrody Labs repositories
with source visibility preserved (205 public, 34 private). Migration is ongoing:
complete Git refs, archived flags and LFS payloads have separate gates. Consult
`tools/config/host/apps/vps/gitea/aphrody-labs-mirrors.json` in the configured
Aphrody checkout for the canonical per-repository state. This documentation
does not qualify all 239 mirrors or transfer their write authority.

The root product server has a standalone Windows staging candidate with 15
HTTP gates passing; see [product server](PRODUCT-SERVER.md). Infra reserves
loopback port 29030 and `/api/product/v1/` for the product API, leaving Gitea
on its existing routes. The unit specifies the public HTTPS origin and a
protected environment file. Product installation and activation were rejected
by automatic approval review; the service and ingress remain inactive.

Native application builds and authenticated engine operations retain separate
qualification.
The owner's first video build restored its existing sccache temporary directory
`~/build/cache/sccache/control-plane-tmp` before native job admission; the control
plane deployment did not run Cargo or tests.
