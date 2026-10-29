> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Public Bun WebOS static release

Source at publication (2026-10-11): the public-site package in `aphrody-labs/bun`.
That package path is no longer present in the selected checkout. The current
WebOS runtime integration is tracked at
`packages/app-ui/webos.ts`, which starts the single WebOS server owned by the Bun fork (`apps/desktop/server.ts`, resolved through `APHRODY_BUN_CHECKOUT`); it is not
the static page source for this historical release. The public page runs its
example locally in the visitor's browser. The real WebOS server and assistant
remain separately configured local/private integrations.

The VPS Nginx apex adds `snippets/public-webos.inc`. Its exact allowlist serves
three page files and three checksummed public package archives under
`https://aphrody.com/labs/webos/`. Every other path in that prefix returns 404.
Only GET/HEAD is accepted. The existing apex origin remains
`http://10.200.77.3:18803`; no DBFR application or private Omar route changes.

`omar.aphrody.com` remains private at `10.200.77.10`. The VPS vhost refuses
public requests with 403 and retains its dedicated certificate. HTTP allows the ACME webroot challenge for that
dedicated certificate. `public-webos.routes.json` is the Infra `NginxConfig`
source for the dedicated rendered vhost.

Releases live under `/var/www/aphrody-public-webos/releases/<source-and-id>`.
Record the immutable Bun source commit, exact file SHA256 and archive provenance
in `PROVENANCE.json`, then verify remote bytes before switching `current`.
Keep the previous pointer and the hash-verified original apex config in a
checkpoint. Apply only if original hashes and expected target absence still
match, test with `nginx -t`, then reload. A failed syntax test restores the
checkpoint before any reload. Rollback restores that apex file and previous
pointer, disables the additive Omar vhost, tests and reloads Nginx. Preserve all
release files and the dedicated certificate.

DNS owner: OVH. The exact `omar` A record was restored to `10.200.77.10` with
its identifier and TTL300 preserved, then the zone refreshed. Preserve all other
records, the local Windows hosts pin and the existing apex certificate.
Qualification checks page/asset bytes, archive SHA256, certificate hostname,
redirects and rejected API/model/terminal/unknown paths, plus existing apex,
documentation and Aphrody OS behavior. Six final HTTP/HTTPS private-alias probes
returned 403 without a redirect; the generic apex page returned200. The existing
apex config retains the DBFR origin at `10.200.77.3:18803`.

The first immutable release is `614b3dde802e-20261011`. Its original apex checkpoint
is `/var/backups/aphrody-public-webos/614b3dde802e-20261011/apex.conf` with SHA256
`3751eed7eb38f53643e5204fd33c7f1f83e15a8b929b40f18830f2a59cf2a842`.
Public browser qualification used a new isolated tab: page/CSS/JS200, no host
API requests or console errors, and working local example buttons. Private
API/model/terminal paths and unknown downloads were refused. Nginx syntax passed
before every reload. The full Infra catalog validator still reports the unrelated
existing `omar-redis: unknown topology host local` entry; this release adds no
catalog validation error.

The final active release is `105ac20a30d6-20261011`, from Bun commit
`105ac20a30d635e398e3e7131c75260176e68ff9`. Its WebOS archive is 6190879 bytes,
SHA256 `e6f8387163cde259a1dc2e44be3cf779bfd86cd774437a869ad5e8ec4d374aba`.
The supervisor archive uses commit `e3f9ae9d416a2a82dd435b0c63c267cb2c4dd485`,
19763 bytes, SHA256 `7570448dcd2a18dbc7e97d89a2e2bd507b8cf69c4a189bec45953810621aa5c1`.
The tools archive remains 25779 bytes, SHA256
`af2836de41caae5c165ce1575fdad3e7401147711f996461fff15cab3c35f6ec`.
All three are served under `/labs/webos/downloads/`; this is archive distribution,
not registry publication. Fresh consumer install preserved the bundled owner
Tailwind1.4.4 source. Extraction followed by production install and build passed
with the compatible public Tailwind0.1.0 package. The compiled server served its
page/CSS/JS from an unrelated working directory and refused system metadata403.

The final activation hash-checks seven staged files and the live apex/private
alias configs, records the previous release in `PREVIOUS`, and replaces only the
`current` symlink atomically. It needs no Nginx config modification or reload.
To roll back, first check that `current` still points to this final release and
that `PREVIOUS` matches the first release, then atomically replace the symlink.
Preserve both releases and all certificates. Local reviewed scripts are
`C:/bun/.coord/omar-public-final-activate.sh` and
`C:/bun/.coord/omar-public-final-rollback.sh`; they contain the exact hash guards.

## Public host ownership

| Host | Frontend | API and backend policy |
| --- | --- | --- |
| `os.aphrody.com` | Existing canonical OS root; additive `/desktop/` contains browser desktop/apps | Exact `/api/webos/capabilities` returns browser-safe flags with host access disabled. Exact `/dist/workers/repl.js` and `/dist/wasm/bun/bun_wasm.wasm` serve the browser artifacts when present. Exact `/api/search` uses the shared public backend on VPS loopback8797. |
| `aphrody.com` | Homepage/search, documentation, templates, guides and downloads; generic `/labs/webos/` page | Exact `/api/search` and `/api/index/search` use the same bounded public backend on VPS loopback8797. Existing DBFR content origin is preserved. |
| `omar.aphrody.com` | Private PC console on `10.200.77.10` | Only authorized local/WireGuard installations; the public VPS refuses it with403. No private PC proxy or host API is exposed. |

Search aliases preserve host, query and conditional request headers while emptying
Authorization and Cookie. Public OS has no host API, model, shell, filesystem
backend or native bridge. Browser OPFS and explicit file/device permission gestures
remain local to the visitor. The desktop response alone uses COOPsame-origin and
COEPrequire-corp for a shared-memory WASM worker; existing OS root headers/assets
remain unchanged. An absent neutral Bun WASM artifact remains unavailable, rather
than borrowing the existing canonical Aphrody Rust WASM module.

The desktop is live on VPS loopback18804 through the exact OS routes. Search
aliases currently return a bounded503 JSON error with no-store; they do not proxy
an unqualified backend or fabricate results. The reviewed future proxy contract
preserves Host, query and If-None-Match and clears Authorization/Cookie. Activate
it only after the public backend's real data and conditional-request gates pass.
Navigation links explicitly cross between the OS desktop and apex surfaces.

## Public desktop qualification

The tracked generic container profile is Bun commit
`e1cec94f4bc375c551993c1140c269af2ee26f44`. Its GNU runtime is
`1.4.4+dfde053a3`, SHA256
`890af6a675e1dc58b15a15777c53de3b2e82668690c9be5f6e87ec690246ac0e`.
The initial UI snapshot3252 plus the generic theme adapter passed a frozen scan
of60 files and72 relative imports, production build and isolated container checks.
The container runs as UID1000, read-only, all capabilities dropped, loopback-only,
without host mounts. Its SIGTERM exit status was0. Page/CSS/JS/worker returned200;
host system/metrics/filesystem/explorer routes and POSTdesktop returned403.
Unknown WASM artifacts returned404. The original OS root's three asset hashes
were checked unchanged before and after Nginx reload.

The final live UI snapshot is `e466ba7fbeb5e7d8fb1261f04bc1fec483073fde`,
including the browser-safe capabilities check before host polling. Its frozen
source was rebuilt in the admitted lightweight lane, then copied into immutable
image `sha256:dcd76ec8097b289a252c1b06e573e38a4b863cc98835c633997e109a8d936de6`.
Compose replaced only the owned desktop container and passed its health check.
The e466 native core owns the two qualified WASI portability fixes; the same
checksummed WASM artifact and its manifest are included in this final image.

The neutral WASI artifact is277049 bytes, SHA256
`3ada60bf75a9c02cfddab5d753705055f97dad434ebcc8aba5995307d2887c26`,
qualified by the native factory and actual Chrome. Public HTTPS qualification
also passed using Bun.WebView with a fresh Chrome backend: crossOriginIsolated,
worker initialization, Bun1.4.4, semver, Markdown and OPFS write/read. The worker
response needs COEPrequire-corp as well as the desktop response; these exact
headers preserve the canonical root's existing policy. Capabilities report
hostAccessfalse and bunWasmtrue. This does not claim a complete JSC or OS kernel
inside WASM, a Windows container, a musl/Alpine runtime, or a native host bridge.

The generic landing's new immutable release is `e1cec94f-20261011`; its navigation
links to `/desktop/`. The WebOS archive remains the qualified105ac artifact above.
The supervisor download is now19820 bytes from306b471, SHA256
`6687fd3afedec0b5fbbf46f5687b5ee4e68adda35ca2436969af1a9f29c88c29`.
The previous105ac release remains intact for rollback; private Omar is unchanged.

Reviewed local activation/rollback pairs are
`C:/bun/.coord/bun-os-desktop-{activate,rollback}.sh`,
`C:/bun/.coord/bun-os-pending-{activate,rollback}.sh` and
`C:/bun/.coord/bun-os-static-{activate,rollback}.sh`. They guard exact live hashes
and preserve checkpoints under `/var/backups/aphrody-bun-os/`. Roll back pending
aliases before the desktop route, then atomically restore the105ac static pointer
if needed. Keep both image artifacts and release directories. Candidate future
search-proxy scripts are `bun-os-routes-{activate,rollback}.sh`; they require a
real successful backend probe and must be re-guarded against the active hashes.

## Ownership (single WebOS)

- Bun fork (`apps/desktop`): the WebOS application, server (`startWebOS`), `bun_wasm` runtime and e2e tests.
- bun-os: the browser backend `crates/aphrody-webos-wasm` + `packages/webos-wasm` (OPFS file system), `packages/app-ui` shell, nginx, Docker and distribution. No second server or UI exists.
