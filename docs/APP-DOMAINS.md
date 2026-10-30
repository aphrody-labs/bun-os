# Application domains

The 14 library application identities come from the
`@aphrody/bun-workspace` capability catalog. Aphrody Infra owns the concrete
hostname and DNS intent in `tools/config/cloudflare/aphrody.app.json`; its
read-only domain audit checks those values against the capability catalog,
Bun OS distribution inventory and Bun Worker configuration. This page is the
consumer map for that contract. The canonical form is
`app-<capability>.aphrody.app`, with the forked library hostname as an alias.
APT and the Bun desktop keep product hostnames in the Bun OS distribution
inventory, which Infra also checks against its desired state. Bun owns Worker
runtime and routing configuration. The homepage, www redirect and assets/dist
R2 custom domains retain their existing owners.

## Canonical origin and paths

The canonical origin is https://aphrody.com. Product hosts are no longer
separate identities: each one answers a permanent 301 to a path of the apex,
preserving the sub-path and query string. The apex is served by the native Bun
WebOS service on the VPS; Cloudflare DNS is authoritative but does not proxy the
apex or `www`. The declarative source is
`infra/config/routes.catalog.json` (host to `{kind, path, keep}`, plus the
path to WebOS package map). The shared WebOS request handler
(`apps/webos/worker/index.ts`), hosted natively on the apex and by the Worker on
app aliases, derives `redirectFor` from it. The shell opens the package of a
catalog path, and the legacy `/?app=<package>` link redirects to that path.
`bun.aphrody.com` and `bun.aphrody.app` are the Bun site (Worker `aphrody-app`, owned by the bun repo) and are not routed by this catalog.

Hosts that stay separate (`keep: true`): `deploy.aphrody.app`, `downloads.aphrody.com`, `cdn.aphrody.com`, `assets.aphrody.app`, `dist.aphrody.app`, `nie.aphrody.com`.

| Host | Kind | Redirects to |
| --- | --- | --- |
| app-video.aphrody.app | app | https://aphrody.com/film |
| filmcraft.aphrody.app | craft-alias | https://aphrody.com/film |
| app-generation.aphrody.app | app | https://aphrody.com/art |
| artcraft.aphrody.app | craft-alias | https://aphrody.com/art |
| app-images.aphrody.app | app | https://aphrody.com/photo |
| photocraft.aphrody.app | craft-alias | https://aphrody.com/photo |
| app-vectors.aphrody.app | app | https://aphrody.com/vector |
| vectorcraft.aphrody.app | craft-alias | https://aphrody.com/vector |
| app-compositing.aphrody.app | app | https://aphrody.com/effect |
| effectcraft.aphrody.app | craft-alias | https://aphrody.com/effect |
| app-photo-processing.aphrody.app | app | https://aphrody.com/light |
| lightcraft.aphrody.app | craft-alias | https://aphrody.com/light |
| app-pdf.aphrody.app | app | https://aphrody.com/pdf |
| pdfcraft.aphrody.app | craft-alias | https://aphrody.com/pdf |
| app-documents.aphrody.app | app | https://aphrody.com/word |
| wordcraft.aphrody.app | craft-alias | https://aphrody.com/word |
| app-audio.aphrody.app | app | https://aphrody.com/sound |
| soundcraft.aphrody.app | craft-alias | https://aphrody.com/sound |
| app-layout.aphrody.app | app | https://aphrody.com/design |
| designcraft.aphrody.app | craft-alias | https://aphrody.com/design |
| app-cad.aphrody.app | app | https://aphrody.com/cad |
| cadcraft.aphrody.app | craft-alias | https://aphrody.com/cad |
| app-slides.aphrody.app | app | https://aphrody.com/deck |
| deckcraft.aphrody.app | craft-alias | https://aphrody.com/deck |
| app-tables.aphrody.app | app | https://aphrody.com/grid |
| gridcraft.aphrody.app | craft-alias | https://aphrody.com/grid |
| app-interface-layouts.aphrody.app | app | https://aphrody.com/fig |
| figcraft.aphrody.app | craft-alias | https://aphrody.com/fig |
| craft.aphrody.app | craft | https://aphrody.com/art (sub-paths kept) |
| play.aphrody.app | product | https://aphrody.com/play |
| apt.aphrody.app | product | https://aphrody.com/apps |
| desktop.aphrody.app | product | https://aphrody.com/apps |
| os.aphrody.com | product | https://aphrody.com/os |
| creator.aphrody.com | product | https://aphrody.com/creator |
| aphrody.app | legacy-apex | https://aphrody.com/ |
| www.aphrody.app | legacy-apex | https://aphrody.com/ |
| www.aphrody.com | www | https://aphrody.com/ (sub-paths kept) |

`play.aphrody.app/` still goes through `playRedirect` to `/workspace/games`
first. The apex and `www` are served by the native VPS origin; Worker-backed
application aliases redirect to it. `os.aphrody.com` and `creator.aphrody.com`
retain their Nginx owners until their vhosts redirect.

## Previous hosts

The 14 library applications keep `app-<capability>.aphrody.app` routes and
their capability-alias custom domains on the `aphrody-webos` Worker. Those
hosts redirect to the native apex as listed above.

## Routing and qualification

The existing application hostnames are attached to the configured edge.
Cloudflare owns its DNS record and certificate provisioning. Its managed,
proxied DNS record routes to the Worker; it is not a private backend address.
Domain changes use the configured Cloudflare MCP and preserve existing DNS or
Worker ownership when a hostname conflicts.

A valid DNS answer and HTTPS response qualify public edge routing. Both names
currently share the existing edge response. Application executables,
application behavior, native backends and independent deployment require their
own build and deployment receipts. A hostname response does not qualify those
application capabilities.

The 14 canonical `app-*` Worker routes and the capability-alias custom domains
belong to `aphrody-webos`. Its other enabled `aphrody.app` custom domains
include the apex, `www`, APT, and desktop. `video.aphrody.app` remains an R2
custom domain, not an application alias. The `aphrody.com` and `www` records
are DNS-only and have no Worker route or custom domain.

Read-only Cloudflare inspection on 2026-10-25 found the 14 deployed `app-*`
routes and `play.aphrody.app/` on `aphrody-webos`; no route or custom domain
for `aphrody.com` or `www.aphrody.com`; and DNS-only apex/www records to the VPS.
The live `https://aphrody.com/api/health` response returned HTTP 200 with no
Cloudflare colo and identified the native WebOS service. These checks establish
the serving path and health response, not full application qualification.

The ignored out/app-domains/receipt.json records preflight DNS/domain ownership,
creation results, read-back checks, public DNS/HTTPS observations, and separate
certificate provisioning state. No Worker code upload is part of hostname
attachment. Shared assets and artifacts use their existing R2 custom domains;
application hosts do not duplicate asset objects.

API owner: [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Craft browser frontends

`https://craft.aphrody.app/<app>/` serves the static wasm32 builds of the Craft
web apps (`/cad/`, `/deck/`, `/design/`, `/effect/`, `/fig/`, `/film/`, `/grid/`,
`/light/`, `/pdf/`, `/photo/`, `/sound/`, `/vector/`, `/word/`) and the ArtCraft
frontend at `/art/`, behind a searchable, responsive studio directory at `/`. The
Cloudflare record is a proxied `A craft` to the VPS, the TLS certificate is a
Let's Encrypt ECDSA certificate issued like `play.aphrody.app`, and the vhost is
`infra/config/host/nginx/craft/craft.aphrody.app.conf`.
`scripts/aphrody/tools/infra/deploy-craft-frontends.ts` runs on the VPS through
the existing factory, with `run --slots 1 --max-slots 1 --`. It reuses
`apps/webos/build-craft.ts` for all thirteen Rust dependency graphs, fonts,
workers and WebAssembly assets, and ArtCraft's frontend owner for `/art/`.
Use the runtime declared by `aphrody.config.json`, with the installed native
Material 3 binding (or an explicit local development artifact).
Set `APHRODY_BUILD_HOST=vps` for the deployment process; the script refuses
workstation execution or an unlabelled host.

All fourteen studios must assemble before deployment. A release is written to
`~/apps/craft-web/releases/<timestamp>` with artifact SHA256 hashes, Cargo lock
identity, runtime and source state in `release.json`. Nginx serves the release
through an atomic `current` symlink; the previous release remains available for
rollback. Configuration is checked with `nginx -t`, and all fourteen origin
routes are checked over TLS after activation. A failed activation restores the
previous release and Nginx configuration. `--skip-build` explicitly reuses a
complete existing WASM assembly; ArtCraft is still built. There is no partial
deployment mode. FilmCraft is served statically by Nginx, without a development
server on port 8765. No Cloudflare Pages or Worker deployment is involved; the
existing Cloudflare DNS/proxy layer is separate from VPS hosting.

ArtCraft is a browser preview of its desktop frontend. The browser shell does
not initialize desktop background services, account polling or native model
discovery; generation and account operations still require the desktop host.
This is separate from the thirteen standalone WebAssembly editor start-up
checks and must not be reported as a qualified browser generation backend.

## Applied on Cloudflare (read-only state, 2026-10-25)

- Zone `aphrody.com`: the `bun.aphrody.com` redirect rule created earlier the same day was deleted again
  (the Bun site lives on `bun.aphrody.com` and `bun.aphrody.app`, attached to the `aphrody-app` Worker by the bun
  repo). No redirect rule remains in that zone from this catalog.
- The apex and `www` Worker routes were removed during the native VPS migration.
  `apps/webos/deploy.ts` now creates a native release handoff; it does not
  publish the apex Worker. The existing Worker remains deployed for application
  aliases and product hosts under `aphrody.app`.
- Zone `aphrody.app`, ruleset `4189be37cb1b498390a81986470650a7` (phase `http_request_dynamic_redirect`), rule
  `8d637dcb359446369ad4d93fdf21b8d2`: on host `aphrody.app`, `/install`, `/install.sh`, `/install.ps1`,
  `/llms.txt`, `/llms-full.txt`, `/docs/*` and `/api/bun/*` answer a 301 to the same path on
  `https://bun.aphrody.app` (query kept), because the Bun site lives there. Requested by the bun repo owner
  session and confirmed by the owner. The existing `www.aphrody.app` rule is untouched. To undo, delete the rule.
