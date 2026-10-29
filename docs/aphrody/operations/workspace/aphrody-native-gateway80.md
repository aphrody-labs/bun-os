<!-- SPDX-License-Identifier: Apache-2.0 -->

# Native Aphrody through the existing PC port80 gateway

Infra adapter: `scripts/tools/infra/site-gateway.ts` (Bun, no PowerShell; registry
proof through `bun:ffi` in `win32-net.ts`). It adds only
a marked Aphrody server/upstream to the existing Nginx configuration, generated
by `aphrody infra nginx render` from its typed JSON model. It preserves existing
bot and CDN blocks, container lifecycle, firewall and authentication stores.

Host configuration lives in the configured Aphrody home's `host/` directory:

```json
{
  "home": "C:/Users/OWNER/.aphrody",
  "sourceConfig": "C:/path/to/compose-gateway.nginx.conf",
  "container": "gateway",
  "registry": "C:/ProgramData/Aphrody/site/run/native-services/site.json",
  "serverNames": ["localhost", "127.0.0.1", "aphrody.local", "aphrody.com", "www.aphrody.com"],
  "expectedSourceSha256": "REVIEWED_PLAN_SHA256"
}
```

Paths resolve from this explicit host configuration. Registry PID/start time and
its loopback listener must be live. Only native read-only site traffic is proxied;
no agent RPC/MCP/A2A or host-capability transport is exposed through port80.

```sh
bun --no-env-file scripts/tools/infra/site-gateway.ts plan    # [--config <path>] [--aphrody <exe>]
bun --no-env-file scripts/tools/infra/site-gateway.ts apply
```

The configuration defaults to `<APHRODY_HOME>/host/aphrody-gateway.json`; `--aphrody` selects
the binary that renders (default `aphrody` on `PATH`). `plan` renders and reports with no
Docker/file changes. Removing the marked block restores the source exactly, so repeated applies
do not drift.
Apply verifies the expected original checksum and declared Docker bind mount,
creates a checksum-verified backup outside repositories, copies its candidate to
the container and checks `nginx -t -c` before touching the mounted source. It
rechecks concurrent changes, writes while preserving the mounted inode, compares
container-visible SHA256, validates live configuration and reloads. HTTP
`Host: localhost` port80 `/health` must return native204; failures restore and
validate/reload the original bytes. No container recreation or listener stop.

Persist a stable declared site port before the next boot: current observation
uses36515, but a port0 task may allocate another port after restart. Configure the
startup site to fixed36515 after confirming its ownership, or rerun this Infra
adapter after each dynamic allocation. Do not claim durable boot routing from
a one-time dynamically generated Nginx upstream.

PC resolution of aphrody.com requires the explicit host/DNS owner configuration;
server_names alone does not change DNS. VPS port80 is a separate execution target:
root must apply its declared Infra Nginx/systemd release there and independently
prove HTTP and protected-resource preservation. This PC adapter does not touch VPS.

## Optional local TLS, HTTP/2 and HTTP/3

Generate certificates using native Windows PKI under the owner profile:

```powershell
pwsh -File scripts/tools/infra/aphrody-local-certificates.ps1 -HomeDirectory $AphrodyHome -DryRun
pwsh -File scripts/tools/infra/aphrody-local-certificates.ps1 -HomeDirectory $AphrodyHome -Apply
```

Trust is added only to CurrentUser Root. The CA private key remains nonexportable in CurrentUser My; the protected PEM is the leaf key. Renewal uses `-Renew`; replacing an unavailable/expiring CA requires explicit `-RotateCa`. Local SANs cover localhost, aphrody.local, 127.0.0.1 and ::1. Public Aphrody domains need a separately authorized public certificate; this local CA does not qualify them.

Before gateway TLS apply, declare an Infra-reviewed Compose override for the existing gateway service:

```yaml
services:
  gateway:
    ports:
      - "443:443/tcp"
      - "443:443/udp"
    volumes:
      - type: bind
        source: ${APHRODY_LOCAL_TLS_DIRECTORY}
        target: /etc/aphrody-local-tls
        read_only: true
```

Keep the existing base Compose and protected env-file; this override does not change images, networks or other services. The host source must be the configured home `credentials/tls/local` directory. Applying Compose is a separate declared host operation. Add gateway JSON property `tls` with `enabled: true`, `directory` (absolute host path), `containerDirectory: /etc/aphrody-local-tls`, `quic: true` and `certificateSha256`/`privateKeySha256` copied from the protected certificate manifest. No certificate or private key belongs in Git.

The gateway checks host and container certificate hashes, read-only mounts and published TCP/UDP 443 before changing Nginx. Candidate `nginx -t` must support `http2 on`, and when requested, `http3 on` and QUIC listeners; unsupported binaries fail before live configuration changes. HTTPS health validates the certificate against the declared local CA (second certificate of the protected `leaf-chain.pem`). HTTP/2 and HTTP/3 still require real client protocol negotiation gates; rendered directives alone do not establish those protocols. TLS verification failure rolls back the gateway configuration. Existing routes remain preserved.
