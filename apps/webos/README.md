# Aphrody WebOS

This app assembles the Bun OS browser desktop, the shared Workspace UI under
`/workspace/`, the M3 theme, workspace catalog, and installable Craft and Engine
packages. `packages/app-ui` owns the shared interface. `packages/webos-wasm`
wraps the Rust filesystem and RPC adapter; the browser persists user files in
the Origin Private File System (OPFS).

## Production stack

`aphrody.com` is served by the native Bun service on the VPS:

1. Cloudflare provides authoritative DNS. The apex and `www` records are
   DNS-only and point to the VPS.
2. Nginx terminates TLS, redirects `www`, compresses assets, limits API request
   rates, and proxies to `127.0.0.1:8790`.
3. `aphrody-webos.service` runs Bun's `Bun.serve` and the shared HTTP handler in
   `worker/index.ts`. Static files come from the activated immutable `dist/`.
4. The local PostgreSQL reader serves the public documentation/catalog API.
   Alpine Linux runs in the browser through v86/WebAssembly; it is not a VPS
   desktop session.

The Cloudflare Worker named `aphrody-webos` remains for the `aphrody.app`
application hosts and aliases. The apex and `www.aphrody.com` are not Worker
routes. Keep the production route manifest in `wrangler.jsonc` aligned with
that boundary.

The public app-server endpoints do not host conversations or provider sessions.
Those require the native Aphrody app on the user's machine. The public model
list is empty; the unqualified inference and decision routes return an explicit
unavailable response.

## Build and activation

Production builds run on the VPS factory through
`.gitea/workflows/aphrody-sites.yaml`. The workflow builds the Craft packages,
assembles the site, and writes an immutable release with a SHA-256 receipt to
the deployment handoff. The root-owned activation timer verifies the receipt,
checks that the source commit is still the published `os` tip, switches the
release, restarts the service, and confirms both local and public health. A
failed health check restores the previous release.

`build-product.ts` builds `packages/app-ui` for `/workspace/` and then assembles
`dist/`. `build.ts` expects the App UI artifact to exist already. Build the Rust
WebAssembly owner before assembly; missing WASM inputs are reported explicitly.
The site build stages the pinned v86 runtime, BIOS images, and verified Alpine
ISO. No Cloudflare credentials are needed for the native VPS deployment.

## API and data

`serve.ts` adapts the shared Worker handler to Bun's native server and local
filesystem. In production, `WEBOS_DATABASE_URL_FILE` points to the protected
PostgreSQL read-only connection. The database is local to the VPS and uses a
bounded four-connection pool. `BUN_OS_API_ORIGIN` is only for a deliberately
configured local backend; it is not set for the production site.

The browser filesystem and Alpine VM state remain in the visitor's browser.
The VM's ISO and static site assets are served from the VPS release. Game and
large media objects use the service local immutable object paths.

## Production evidence

On 2026-10-25, `https://aphrody.com/api/health` returned HTTP 200 with
`service: aphrody-webos`, no Cloudflare colo, and source commit
`0fba9d6611d9371a93c2153e324a54fdde5679d7`. A read-only Cloudflare account
inspection found no Worker route for the apex or `www`; both DNS records are
DNS-only. The deployed Worker still has the application-host routes and custom
domains under `aphrody.app`.
