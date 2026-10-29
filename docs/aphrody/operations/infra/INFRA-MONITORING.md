<!-- SPDX-License-Identifier: Apache-2.0 -->
# Infrastructure monitoring

Two distinct tools report on Infra state. The root Bun monitor
`scripts/tools/infra/infra-status.ts` reports checks,
selected host resources and probes. The native `aphrody-infra` CLI reports
catalogued host services and lifecycle state. Neither replaces a complete live
host inventory or application-level readiness checks.

## Bun monitor

Run it from the monorepo root:

```bash
bun scripts/tools/infra/infra-status.ts status
bun scripts/tools/infra/infra-status.ts status --json
bun scripts/tools/infra/infra-status.ts status --deep
```

`--deep` enables the bounded deeper checks implemented by the script. There
are no root `infra:status`, `infra:status:json`, or `infra:inventory` package
scripts in the current manifest.

## Rust service and host status

Use the installed CLI or run the checkout binary through the serialized Cargo
wrapper:

```bash
aphrody-infra status --target vps --json
aphrody-infra service status --target vps --json
aphrody-infra service catalog --json
aphrody-infra validate --json
```

The Rust `status` command reports target/matrix state using its live target
adapter (service counts/failures and selected host details); it is distinct
from the catalog service query. The `service` commands query workloads declared in root
[`tools/config/service-catalog.json`](../../../../infra/config/service-catalog.json); they do
not discover arbitrary systemd units. Use a dated host observation when
reporting complete unit inventory. `validate` checks the current service,
route and port-policy catalogues; it is not a runtime health probe.

## Catalog rules

The root JSON catalogues are authoritative for declared policy:

- `tools/config/service-catalog.json` owns service IDs, units, health paths and
  declared ports;
- `yolo/tools/config/host/nginx/routes.json` owns public hosts and upstream routes;
- `tools/config/production-topology.json` owns host roles and public/internal port
  policy.

Retired services remain recorded as evidence and must not be treated as
deployable workloads. A declared route or unit does not establish that the
corresponding runtime object is installed or active.
