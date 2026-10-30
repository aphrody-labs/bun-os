# Aphrody super-site

This app assembles the WebOS desktop, the canonical App UI under `/workspace/`,
the shared M3 theme, workspace catalog and installable Craft/Engine browser
packages. `packages/app-ui` owns the shared interface consumed by this site and
the native `apps/aphrody-app` host. WebOS-WASM owns the browser filesystem and
its RPC adapter; the native Drive transport keeps its own storage and permissions.

From the repository root on the Linux VPS factory:

```sh
bun src/cli.ts superapp craft
bun src/cli.ts superapp build
bun src/cli.ts superapp serve
```

The product build compiles App UI with `--base /workspace/` into `build/app-ui`,
then assembles this site using that artifact. Set `BUN_OS_APP_UI_DIST` to select
a different intermediate directory under the root `build/`. Build WebOS-WASM through its native owner
before assembly; the App UI build reports missing WASM inputs explicitly.
Craft compilation uses the root serialized Cargo owner and four compiler jobs.

`build:shell` assembles the site from an already staged App UI artifact.
`superapp deploy` runs the product build and stages a hashed native VPS release.

For local serving, set `BUN_OS_API_ORIGIN` to an existing API backend's HTTP(S)
origin, or set `WEBOS_DATABASE_URL_FILE` to the protected local PostgreSQL reader
connection reference. Production reads the `aphrody_site` schema through native
`Bun.SQL`, with four connections, a read-only role and an eight-second statement
timeout. No provider secret enters a bundle or release receipt.

## VPS deployment

`bun apps/webos/deploy.ts` runs on the VPS from a checkout of `main` (fetched and fast-forwarded to `origin/main`). It writes complete releases below `~/src/bun-os/build/webos-deploy/releases`,
then atomically publishes `ready`. The host's `aphrody-webos-deploy.timer` checks
the handoff every 30 seconds. Its root-owned activator verifies artifact hashes,
switches `~/apps/webos/current`, restarts `aphrody-webos.service` and checks the
served source commit. A failed activation restores the previous release. The
queue does not give build jobs host SSH credentials or the Docker socket.
The activator reads `origin/main` of the VPS checkout (`~/src/bun-os`) and
ignores a superseded queued release, preventing an older build from rolling
back a newer deployment.

`WEBOS_PREBUILT_DIST` explicitly imports an existing static artifact during a
migration; the receipt records that import. Ordinary deployments build App UI
and WebOS from source. The ISO is verified against its official checksum and
included as a local release object. Shared immutable game objects may also live
under `WEBOS_OBJECTS`; no R2 client is used by the native service.

The public ingress is `infra/config/host/nginx/aphrody/webos-vps.conf`. It serves
`aphrody.com` through loopback port 8790, redirects `www`, compresses assets and
limits API traffic. TLS uses the `aphrody-webos-vps` Certbot certificate, renewed
by HTTP-01 through `/var/www/letsencrypt`. It also covers the direct VPS
`downloads.aphrody.com` and `cdn.aphrody.com` endpoints.

## Migration evidence, 2026-10-24

The apex, www, downloads and CDN records are DNS-only A/CNAME records targeting
the VPS. The apex and www Worker routes were removed. The first activated API reported
source commit `d988e5630dc554ec9f6779efbc8edad9a63e64fb` and no Cloudflare colo.
The first release preserves the deployed static artifact: the shell JavaScript
and Workspace HTML matched their public versions by SHA-256 before cutover.

The existing source database was dumped and restored into the dedicated
`aphrody-webos-db` service through the host's root Compose project. All ten table
counts matched: 4,413 documents, 5,545 chunks, 40,000 native graph nodes and
58,495 graph edges. The source and protected backup remain intact. The 51,380,224
byte Alpine image matched its official SHA-256; partial requests returned 206.
Types, lint, formatting, native bundling, the Git private-content guard and
nginx configuration checks ran on the VPS. No test suite was added or run.

The production package registry was already empty before migration. This
cutover does not qualify the missing Craft/emulator packages or enable a new
inference provider. The source catalog is the preserved read-only snapshot;
future source publication must target its new local database deliberately.

Measured deployment bottlenecks: the Sites pipeline initializes a broad source
closure and compiles the complete Craft suite on each run; its persistent
workspace log contains a missing nested Dolphin/pugixml revision. At inspection
the VPS root filesystem was 94% full, swap was almost full, and I/O pressure
showed roughly 30–50% stalled time while `/home` still had about 125 GiB free.
These are capacity and pipeline findings, not evidence that Cloudflare itself
was slow. The former loopback WebOS process ran a deleted binary without a
service supervisor; the new service replaces that public dependency.
The native qualification workflow now ignores website-only/deployment-only
pushes and uses a shallow checkout. Its separate manual dispatch still permits
native qualification and admitted app builds. During this cutover its former
full-history checkout ran alongside Sites and I/O stalled time exceeded 60%.

Remaining provider scope: authoritative DNS still uses Cloudflare. The distinct
Bun homepage, Auto tunnel, R2 video endpoint and legacy `aphrody.app` aliases
have separate live owners. Changing the parent nameservers requires preserving
or migrating those services first; the OVH mirror currently lacks some of their
records. The native service, its database, VM image, downloads, CDN and HTTP-01
certificate no longer require Cloudflare in their serving path.

## Cross-origin isolation

Every page of the shell (and the Browser app's `/api/browse` frames) is served with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`
(`worker/isolation.ts`). That makes `SharedArrayBuffer` available for the threaded emulators and the
interactive Alpine guest, while third-party images and styles keep loading without credentials.
A document embedded in the shell must carry the same headers or Chromium blocks it; `test/isolation.test.ts`
checks all three behaviours in a real Chrome.
