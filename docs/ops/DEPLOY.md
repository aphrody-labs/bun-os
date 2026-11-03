# Deploy

A deployment promotes an artifact that was built once, from a published commit of `main`, and verified by its
receipt. Nothing is built on activation and nothing is edited by hand on a host. This follows SRE release
engineering practice ([sre.google](https://sre.google/sre-book/release-engineering/)): hermetic builds, immutable
releases, a recorded receipt, automatic health gates and an instant rollback to the previous release.

## Release layout (every service)

```text
<handoff>/releases/<commit>-<epoch-ms>/   immutable release: binaries, assets, receipt.json (sha256 of every file)
<handoff>/ready                           pointer written last by the release script; consumed by the activator
~/apps/<app>/current -> <release>         the live release (atomic symlink switch)
```

The activator verifies the receipt and that the commit is on `main`, switches `current`, restarts the unit, waits
for the health endpoint to serve the new commit, and switches back on failure. Four releases plus the active one
are kept.

## aphrody.com (WebOS)

| Step     | Where                          | Command / unit                                                                              |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| Build    | `vps`, checkout `~/src/bun-os` | `crates/aphrody-webos-server/release.sh` (server binary, wasm client, receipt)              |
| Activate | `vps`, root                    | `aphrody-webos-deploy.timer` → `/usr/local/libexec/aphrody-webos-activate.ts`               |
| Serve    | `vps`                          | `aphrody-webos.service` on `127.0.0.1:8790`, nginx `aphrody.com` → upstream `aphrody_webos` |
| Verify   | anywhere                       | `curl https://aphrody.com/api/health` reports the source commit                             |

Continuous delivery runs the build when the presubmit gate is green and the WebOS inputs changed
([AUTOMATION.md](AUTOMATION.md), lane `webos`). By hand:

```sh
ssh vps 'cd ~/src/bun-os && git pull --ff-only origin main && crates/aphrody-webos-server/release.sh'
```

`aphrody.com` and `www.aphrody.com` are DNS-only records that terminate at nginx on `vps`. Cloudflare's
`aphrody-webos` Worker serves the application hosts under `aphrody.app`; keep those routes apart from the apex.
Cloudflare changes go through the Cloudflare MCP.

## Other Bun OS services

`infra/apps.json` is the build and asset inventory (inputs, native package needs, source revisions). Host
services, compose profiles and routes are desired state under `infra/config/host/` and are applied by the delivery
lanes (`nginx`, `compose`, `store`, `activator`, `automation`). The Rust control plane (`crates/aphrody-infra`)
stages verified binaries and units; it is not a second deploy path.

## Images

Disk images and ISOs are release artifacts of build stage 4 ([BUILD.md](BUILD.md)); they are published to
`aphrody.com/downloads` only after stage 5 qualification, with a signed checksum file.

## Shenron

Shenron (dragonballfr.com, host `prod`) is a separate project with its own release pipeline
(`shenron-autodeploy.service` on `prod`). No Bun OS lane builds, deploys or restarts it; the fleet only owns its
host access, mesh and firewall ([FLEET.md](FLEET.md)).

## Promotion to production (`vps` → `bunos`)

`infra/fleet/promote.ts` moves a release built on `vps` to `bunos`. It verifies the receipt and that the commit is on
`main`, copies the release over the mesh (rsync, hard links against the active release), verifies the receipt again
on `bunos`, switches `~/apps/<app>/current` atomically, restarts the unit, waits until the health endpoint reports
the release commit, and switches back on failure.

```sh
bun infra/fleet/promote.ts --app webos --release ~/src/bun-os/build/webos-deploy/releases/<commit>-<ms> \
  --unit aphrody-webos.service --health http://127.0.0.1:8790/api/health      # --dry-run verifies only
```

From Git Bash, prefix `MSYS_NO_PATHCONV=1` so `/home/...` arguments are not rewritten into Windows paths.

## API gateway

`api.aphrody.com` (Cloudflare proxied, Let's Encrypt origin certificate, SSL strict) terminates at nginx on `bunos`.
Routes are declared in `infra/fleet/api.toml` and rendered by `bun infra/fleet/api.ts apply`, which also installs
the mesh-only listener on `vps` (`10.200.77.1:8080`) for services still running there. Moving a service to `bunos`
changes only its `host` in `api.toml`. Contract: [API.md](API.md).
