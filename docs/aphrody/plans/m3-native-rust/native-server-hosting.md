<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native product server hosting

Owner directive, 2026-10-09: Aphrody product HTTP, API, AI, cloud, CLI, UI and
MCP behavior stays in Rust. The Bun fork owns the generic runtime and system
layer. This hosting proposal connects the new native product site to existing
Infra deployment owners. It does not activate a host or replace a domain route.

## Public site and control plane

The product owner is [aphrody-site](../../../crates/web/site/Cargo.toml): Axum,
Tokio, native SSR and one `Catalog` shared by HTTP, CLI and MCP. Public handlers
are documentation, templates, Material 3, read-only catalog JSON, stylesheet,
health and an optional redirect to the separately configured Bun WebOS origin.
The redirect does not give a remote page host execution or privileged proxying.
No JavaScript business server, browser engine, model or provider session is
needed to serve these product pages.

Default topology: **existing nginx on port80/443 → loopback Rust site listener**.
Use the declared site hostname and an allocated internal port, initially the
standalone CLI's default `127.0.0.1:3000` when the host inventory confirms it is
available. Preserve current public names, certificates and gateway routes.
The native site's `/api/docs` and `/api/templates` are public catalog endpoints;
they are not a wildcard proxy to MCP, A2A, Infra or provider APIs.

The canonical `aphrody-mcp` remains a separate control-plane process/transport.
MCP and A2A listeners stay on loopback or their explicitly declared protected
host interface, with their existing authentication and permission controls.
Do not place their routes in this public site's nginx location. An accessible
network endpoint is not an expanded resource or deployment permission.

## Configured Linux hosting

Templates awaiting Infra rendering and host qualification:

- [systemd unit](../../../../infra/config/host/systemd/aphrody/aphrody-site.service.example)
- [nginx route](../../../../infra/config/host/nginx/aphrody/aphrody-native-site.conf.example)

The `.example` suffix intentionally prevents them from being installed as live
units/routes. Infra must render `__PLACEHOLDER__` tokens from the selected host's
inventory, qualify the artifact checksum/target and register the service/route
before applying. No machine checkout path is assumed. `APHRODY_WORKSPACE_ROOT`
points at the deployed read-only template catalog; `APHRODY_SITE_BIND` is the
allocated loopback socket. `BUN_WEBOS_URL` is optional and belongs to the separate
runtime showcase deployment. Binary path, service identity and environment-file
path are host configuration, not credentials committed into the repository.

The site needs no provider authentication. Existing provider credentials,
cookies, session histories and profile stores stay in their isolated owners;
do not copy them into the site environment file, template tree or release bundle.
Use a dedicated unprivileged site identity with read access to the product
catalog. The unit limits restart frequency and uses a read-only filesystem
sandbox. It has no lazy-engine feature activation at startup. Models, GPU,
browser and Bun runtime artifacts belong to their existing capability owners.

Host workflow through Infra: render into staging, validate the manifest and
service/port allocation, validate systemd/nginx configuration, launch a qualified
native artifact on the planned loopback address, then verify `/health`, public
catalog JSON and SSR before routing. Preserve the previous declared route and
artifact for rollback. Apply/reload through the catalog/runbook for that host;
this document is not an instruction to edit a live nginx or systemd directory.
Yoyo administers Aphrody Labs; DBFR administration remains Omar's authority.

## Windows port80 and direct native hosting

Observed on the owner workstation at 2026-10-09: port80 has listeners owned by `com.docker.backend` PID7156 (`::`) and `wslrelay` PID39044 (`::1`). These are live existing bindings, not proof that the Rust site owns port80. No listener was stopped, WSL started or Docker gateway changed by this work. Recheck native listener/PID/service ownership before any activation because PIDs and bindings change.

Windows can run the native site behind the existing gateway, or use the normal
loopback site listener for local development. Request a hostname/path route from
the gateway owner rather than competing for the occupied port. A later host
plan may allocate public80 directly to Rust once the owning gateway and routes
are deliberately integrated. The public process must remain this read-only
product site; MCP/A2A/host-control listeners remain separate and authenticated.
Native Windows does not use systemd. Its service/supervision/install owner is
Infra using the qualified native process artifact. Bun-owned Windows/system
bindings are reused; this plan creates no extra Win32 service binding.

Direct public hosting is an alternative, not the default: the standalone Rust
server accepts `--root <configured-catalog> --bind <allocated-address>:80`.
On Linux low-port binding requires a host-approved socket/capability allocation;
do not run the whole site as root to obtain it. Firewall, TLS and origin routing
are host-specific gates. The current standalone server is HTTP, so it does not
by itself replace the existing public TLS gateway/certificate owner.

## Stable and dynamic endpoint allocation

Public80/443 and control-plane names are declared endpoints. Internal ports may
be dynamically allocated only with durable discovery:

1. Resolve the configured host/service identity and bind the intended interface
   **once**, using port0 when dynamic allocation is explicitly selected.
2. Retain that exact listening socket and read its assigned address. Do not
   scan for a free port, release a probe socket, then bind it again: another
   process can acquire the port in the gap.
3. Persist the bound address, process/service instance, target, protocol,
   generation and readiness state atomically through Infra's service discovery
   manifest/registry, in the configured runtime-state store. No secret or cookie
   values belong in the discovery record.
4. Only after persistence and successful health qualification expose or reload
   the proxy route. Consumers discover the endpoint through the manifest and
   service identity; they do not guess a fresh random port.
5. On restart, replace the instance/generation atomically. Reject stale process
   records; on orderly stop remove or mark the owned record inactive without
   deleting another instance's allocation.

The present site `serve` implementation can bind port0 and print `local_addr`,
but does **not** persist discovery/readiness. Dynamic proxy activation remains
unimplemented until Infra supplies this handshake. Use a declared fixed
loopback listener for the deployment templates meanwhile. MCP/A2A discovery
must keep their stable catalog identities and authenticated transport contracts;
ephemeral ports are not a replacement for those manifests.

## Capability owners and actual exposure

This is a bounded source inventory, not a claim that every product capability is
installed, enabled or exposed over every transport.

| Capability | Rust owner | Current integration / limit |
| --- | --- | --- |
| Public site and catalog | `crates/web/site` | Native SSR/HTTP, `Catalog` model; deployment requires qualified artifact and host route |
| CLI product commands | `crates/infra/aphrody-command` | Shared command dispatch; native site subcommand integration is source work, installed CLI qualification separate |
| MCP catalog | `crates/ai/mcp/src/site_tools.rs` | Typed `aphrody_site_catalog`, same site owner; MCP artifact rebuild/activation separate |
| Unified MCP control plane | `crates/ai/mcp` | Canonical rmcp router; browser, inference, RAG and other features have their own gates |
| AI HTTP and provider gateways | `crates/ai/mcp/src/http_rest.rs` | Native HTTP adapters; existing authentication, provider stores and engine owners remain authoritative |
| Infrastructure API | `crates/infra/infra/src/api.rs` | Separate control-plane API, not mounted by public site |
| Cloud/hosts | `crates/infra/{infra,ssh,ovh,git}` | Catalog/factory/deployment workflows; host authority and protected credential access remain scoped |
| App UI | `crates/ui/app`, `crates/ui/*` | Product consumes native catalog; generic app/framework/system pieces follow Bun handoffs |
| System/runtime layer | Bun fork SDK and native packages | Qualified receipts are prerequisites for consumer migration; no system bindings duplicated here |

The MCP manifest and Cargo feature graph determine the actual tool set. Enumerate
the deployed server's `tools/list` and inspect its running artifact identity when
claiming exposure. Source functions and callable session tools do not establish
that a newly built production server has activated the same features.
