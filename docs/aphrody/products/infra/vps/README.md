<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS architecture and topology

Operator overview of the production application VPS (SSH alias `vps`). It explains the layers
and where each fact is recorded; it deliberately does not restate addresses, ports or unit lists,
which drift. Restored from the retired `aphrody` monolith (`docs/vps/` (not in repo)) and rewritten against the
catalogs of this repository.

| Fact | Source of truth |
|---|---|
| Workloads, units, health URLs, loopback ports, source repositories | [`tools/config/service-catalog.json`](../../../../../infra/config/service-catalog.json) |
| Public hosts, Nginx upstreams and internal routes | `yolo/tools/config/host/nginx/routes.json` |
| Host roles, priorities, public and loopback-only ports | [`tools/config/production-topology.json`](../../../../../infra/config/production-topology.json), [`docs/products/infra/PRODUCTION-ALLOCATION.md`](../PRODUCTION-ALLOCATION.md) |
| Targets and SSH aliases | `yolo/tools/config/host/inventory/targets.json` |
| Last dated observation of the host | `yolo/tools/config/host/inventory/vps-source.json` (evidence, never live state) |
| Kernel, sysctl and journald tuning | `yolo/tools/config/host/aphrody-os/VPS-TUNING.md` (reference proposal, not an installed configuration) |
| Release layout and activation | [`docs/operations/infra/IMMUTABLE-RELEASES.md`](../../../operations/infra/IMMUTABLE-RELEASES.md), [`iecode/docs/rg/operations/RG-IMMUTABLE-RELEASES.md`](https://github.com/aphrody-labs/iecode/blob/main/docs/rg/operations/RG-IMMUTABLE-RELEASES.md) |

The 2026-10-02 VPS observation
is the latest host snapshot represented here. A unit present in a catalogue is
declared intent, not proof that it is installed or running. Re-observe host
units and active releases before making a current operational claim.

## Contents

1. [System services](#system-services)
2. [Application planes](#application-planes)
3. [Network and Nginx](#network-and-nginx)
4. [Detailed pages](#detailed-pages)

## System services

The distribution's systemd is the supervisor (see the root `README.md`, "Current decision").

- **PostgreSQL** (distribution package, `postgresql@<major>-main.service`): relational store,
  reachable through the local Unix socket and loopback TCP only. The intended host role and
  database authority are declared in `tools/config/production-topology.json`; service observations do
  not prove database integrity. See [DATABASES.md](../../../reference/infra/vps/DATABASES.md).
- **Redis** (`redis-server.service`): loopback-only cache, offline queues and distributed locks.
- **Nginx**: the single public reverse proxy; it terminates TLS and forwards to loopback
  upstreams declared in `yolo/tools/config/host/nginx/routes.json`.

Their ports are listed under `hosts.vps.network` in `tools/config/production-topology.json`; none of
them is public.

## Application planes

Each plane has its own release root (`releases/`, `current`, `shared/`) declared by the
`workingDirectory`, `releaseRoot` and `policies.applicationRoots` entries of the service catalog.

| Plane | Catalog services | Built from |
|---|---|---|
| `nie` | retired: `nie-site`, `nie-model-serve` | retired VPS allocation |

The historical Aphrody release procedure is recorded in
[`IMMUTABLE-RELEASES.md`](../../../operations/infra/IMMUTABLE-RELEASES.md);
the current catalog marks its services retired. Do not assume that this plane
was redeployed from the existence of an adapter or release procedure.

### Agents on the VPS

Agent MCP settings are operator/profile configuration, not VPS topology. The
catalogue [`tools/config/mcp-google-web.json`](../../../../../tools/aphrody/config/mcp-google-web.json)
is a configuration template; it does not prove which servers are connected in
an agent session or installed on the VPS.

## Network and Nginx

The declared topology policy permits only `80/443` publicly. The 2026-10-02
VPS observation also found UDP listeners whose process ownership was not
established; see that report before making a runtime exposure claim. Routed
HTTP services are intended to bind loopback and be reached through Nginx:

- public hosts map one-to-one to a catalog service in `yolo/tools/config/host/nginx/routes.json` (`routes`);
- path-scoped routes on a shared public host are listed under `internal` with
  their `publicHost` and `paths`;
- `aphrody-infra validate` rejects a route whose upstream port disagrees with the catalog.

Probe a route or a loopback service with `aphrody-infra probe <url> --target vps` rather than
copying ports into documents.

## Detailed pages

- [Databases and storage](../../../reference/infra/vps/DATABASES.md): PostgreSQL databases, Redis usage and embedded SQLite
  stores.
- [RAG and inference](../../../reference/infra/vps/RAG.md): hybrid retrieval, embeddings and synthesis models.
- [REST and GraphQL APIs](../../../apis/infra/vps/APIS.md): API servers, authentication boundaries and Nginx exposure.
- [OVHcloud operations](../ovh/README.md): Manager/API inventory, DNS and VPS runbook.
