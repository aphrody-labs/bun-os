# Aphrody / Bun control

The canonical deployment owner is Bun OS Infra. Its service, port and route
catalogs own the desired state; this directory contains no host registry or
copied Compose files.

Use `bun src/cli.ts infra <command>` from the selected Bun OS checkout. The
existing native capability owner receives that checkout explicitly. Native
binaries must be qualified against the migrated catalogs before applying host
operations; an older installed binary may still expect the previous layout.

Source configuration lives in this repository under `infra/config`:

- `infra/config/service-catalog.json`: services and capability reservations.
- `infra/config/host/host-policy.toml`: host layout and allocation policy.
- `infra/config/host/apps/vps`: the single Compose project and its app includes.
- `infra/config/host/nginx/routes.json`: public routes.
- `infra/config/host/nginx/aphrody/control.aphrody.app.json`: typed ingress.

See [control plane](../../docs/control-plane.md) for qualification and limits.
