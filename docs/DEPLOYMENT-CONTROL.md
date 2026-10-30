# Deployment ownership

`infra/apps.json` is Bun OS's distribution app-build and asset inventory. It
declares target inputs, native package requirements, source revisions and
content-addressed asset roots. It is not a host-service or deployment catalog.
Library capability IDs and application hostnames come from the local
`@aphrody/bun-workspace` package. Bun OS owns target-specific build inputs,
source revisions and app artifact plans.

Bun OS Infra owns host services, Compose profiles, application routes and
standalone app activation through the imported native implementation in
`crates/aphrody-infra`. The root `infra/config/host/` catalog owns desired state.
The existing deployment workflow verifies and stages qualified artifacts before
service and route activation; it is not a second deployment executor.
Source migration does not activate services or expand host-specific permissions.

## Public Aphrody sites

WebOS deploys directly from the VPS checkout of `main`: `git fetch origin && git merge --ff-only origin/main`,
then `bun apps/webos/deploy.ts` builds the native release and writes it to the
`~/build/webos-deploy` handoff. The root-owned
`aphrody-webos-deploy.timer` verifies and activates the release, restarts
`aphrody-webos.service`, and checks the source commit through both loopback and
the public health route. The deployment script has no Cloudflare credentials.

`aphrody.com` and `www.aphrody.com` are DNS-only and terminate at VPS Nginx;
Nginx proxies to Bun on `127.0.0.1:8790`. Cloudflare's `aphrody-webos` Worker
continues to serve the configured application hosts and aliases under
`aphrody.app`. Keep those Worker routes separate from the apex. Craft frontends,
the source portal, and the Bun homepage retain their independent owners and
deployment paths.
