> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Public pages and capability owners — 2026-10-11

This audit reads the current native Windows sources on `main`. The canonical UI
is `m3/packages/app-ui`; `packages/ui/app-ui` does not exist in this checkout.
Aphrody HEAD at inspection was `4954cddc4807a2dfb3f45adb84cbfd5b5480fb29`;
Bun HEAD was `802e775a01de2725e9302d988cd7dfb296addb41`. Concurrent uncommitted
source changes were included in the inspection. This is a source audit, not a
deployed-browser, authenticated-account or model-inference qualification.

The public downloads/site server serves explicit app-ui shells and assets,
anonymous Google search and the published documentation catalogue. It inserts
`<meta name="aphrody-rpc" content="unavailable">` into public shells. Rendering
a shell does not install the native capability used by its component.

## Initial downloads-handler route and API mapping

| Router route                                                | Actual consumer/API                                                                                                                                | Access and owner                                                                    | Current qualification boundary                                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                         | `ProductSearchHome` → `GET /api/search` in a browser; `aphrody/google/search` RPC in Tauri                                                         | Public anonymous search; `@aphrody/bun-google/search` selected by downloads server  | Handler exists, validates web/safe-active requests, returns 503 on owner failure. Live search results need separate proof. Desktop home redirects to `/explorer`.                                                           |
| `/docs`, `/docs/:id`                                        | `GET /api/docs`; generated `public-docs.json` and static article HTML                                                                              | Public read-only; app-ui builder and Workspace downloads server                     | Exactly five article IDs are served explicitly; an arbitrary ID is not an HTTP SPA fallback.                                                                                                                                |
| `/templates`, `/templates/:id`                              | `GET /api/templates` via `loadCatalog`                                                                                                             | Intended public read-only catalogue                                                 | Base shell is served; downloads server has no templates API handler or generated templates catalogue. Detail HTTP slugs are not in its allowlist.                                                                           |
| `/material-3/:page?`                                        | Local component catalogue; runtime scheme requests `GET /api/m3/css`                                                                               | Public demos; `@aphrody/m3-theme` delegates colour generation to Rust               | Shell allowlist contains the 15 catalogue page IDs. Downloads server does not implement the scheme endpoint used by this component.                                                                                         |
| `/showcase/:page?`                                          | Redirect to `/material-3/:page`                                                                                                                    | Public legacy alias                                                                 | Matching 15 aliases are allowlisted. Unknown suffixes do not get a public shell.                                                                                                                                            |
| `/os`, `/explorer`, `/recents`                              | Drive queries `files.directory_listing`, `search.files` through `SpacedriveClient`                                                                 | Browser: `@aphrody/webos-wasm` RPC over local OPFS; desktop: `plugin:aphrody-drive` | Client selects actual WASM transport by default. Artifact loading and individual Drive method support still require browser qualification. `?backend=http` selects a remote daemon transport, not an enabled public daemon. |
| `/terminal`                                                 | `getWebOs().terminal(...)` from the same WASM backend                                                                                              | Browser-local terminal; no native host shell implied                                | Router exists, but downloads server's public shell allowlist omits `/terminal`. Direct public URL cannot load this route through that handler.                                                                              |
| `/file-kinds`, `/file-kinds/:kind`                          | `files.content_kind_stats`, then file-search filters                                                                                               | Drive owner, through chosen WASM/native/HTTP transport                              | Base shell exists; parameterized kind HTTP route is not public-allowlisted. WASM support is not established by this audit.                                                                                                  |
| `/tag/:tagId`                                               | `files.by_tag`                                                                                                                                     | Drive owner; resource-specific query                                                | Router exists but no public parameterized HTTP fallback.                                                                                                                                                                    |
| `/redundancy`, `/redundancy/at-risk`, `/redundancy/compare` | `redundancy.summary`, then filtered file searches                                                                                                  | Drive owner; chosen transport                                                       | All three static shells are allowed. Real volume/query results require the selected backend, not shell success.                                                                                                             |
| `/sources`, `/sources/adapters`, `/sources/:sourceId`       | `sources.list`, `sources.get`, `sources.list_items`, `adapters.list`, `adapters.config`; mutations `sources.create/sync/delete`, `adapters.update` | Drive/source capability owner; native or qualified selected transport               | Static list/adapters shells exist; detail HTTP IDs are not allowlisted. No remote mutation authority follows from a public shell.                                                                                           |
| `/chat`                                                     | `POST /rpc`: `thread/list/start/resume/read/fork`, `turn/start/interrupt`, `model/list`; `GET /events` stream                                      | App-server session owner; desktop bridge invokes `aphrody_rpc` and session channel  | Real methods and transports exist in client source. Public downloads handler exposes neither RPC nor events; no public connected chat is qualified.                                                                         |
| `/models`                                                   | Tauri commands `aphrody_model_catalog/list/pull/cancel/verify/remove`, hardware telemetry                                                          | `crates/ui/app/src/models.rs`, installed native model owner                         | `desktopInvoke` throws outside Tauri; the public shell does not expose model stores or download controls.                                                                                                                   |
| `/studio`                                                   | Tools: `tools/list`, `mcpServerStatus/list`; runtime: `aphrody_system_stats`, `aphrody_benchmark`; local AI: `studio_native_chat`                  | App-server, native desktop and managed `llama-server` owners                        | Public RPC is unavailable. Native chat discovers a ready local model and calls its loopback `/v1/chat/completions`; actual readiness/inference is not qualified here.                                                       |
| `/creator`, `/admin`                                        | `aphrody_kit_start/answer/cancel`; protocol `aphrody.kit/1`, kits `creator` and `omar`                                                             | `crates/ui/app/src/kits.rs` and `packages/infra/product`                            | Bridge refuses outside Tauri. Admin pack/kit availability remains a native owner check; shell publication grants no kit access.                                                                                             |
| `/jobs`                                                     | `JobsScreen` → `@aphrody/drive-client` jobs and `aphrodyJobStore`; existing manager calls `jobs.list/pause/resume`                                 | Drive daemon/events and Aphrody AI-job owners                                       | Router serves a Jobs component; legacy navigation map still declares `jobs → /explorer`, creating a navigation contract discrepancy. No public job execution qualification.                                                 |
| `/settings`, `/settings/appearance`                         | Local settings tabs; latter redirects to `/settings?section=appearance`; model/agent tabs use their existing capability owners                     | Local preferences plus native/app-server capabilities                               | Route/redirect exist. Model and agent settings do not acquire public backend access.                                                                                                                                        |
| `/codex`, `/favorites`, `/search`, `/tasks`                 | Redirect respectively to `/chat`, `/explorer`, `/explorer`, `/explorer`                                                                            | Existing route aliases                                                              | Server allows shells, router then redirects. `/search` is a file-explorer alias; anonymous web search lives on `/`.                                                                                                         |
| `*`                                                         | `ProductNotFound`                                                                                                                                  | Client router                                                                       | Public HTTP handler separately returns its static 404; it deliberately avoids an arbitrary SPA catch-all.                                                                                                                   |

## Initial gaps and remaining capability checks

1. Align public shell serving with the existing `/terminal` route. Preserve the
   browser-local WASM terminal distinction from native host execution.
2. Supply the existing `/api/templates` consumer from its actual template owner,
   and qualify real template IDs and detail URLs. Current catalogue errors are
   honest unavailable states, not functioning templates.
3. Provide the actual Rust-owned `/api/m3/css` scheme service or a qualified
   equivalent source to `httpSchemeSheet`. The current downloads handler does
   not route this endpoint; generated CSS alone does not qualify runtime seed,
   contrast or variant changes.
4. Material's `/material-3/ai` passes `host="native"` to the demo. `Ai.tsx` then
   calls `fixtureStream` locally. This is a component/event-stream demonstration,
   not model inference. Its standalone-host alternative posts `/api/ai/stream`,
   also absent from the public downloads handler. Real local chat instead uses
   `studio_native_chat` and a ready managed model.
5. Validate each Drive query against the shipped WASM module. A real client
   transport does not prove `sources.*`, redundancy, tags, jobs or every archive
   operation is supported. Keep unsupported capabilities explicit.
6. Reconcile valid detail slugs with actual HTTP serving: template IDs, file-kind
   IDs, tag IDs and source IDs currently exist in the client router without a
   corresponding public shell rule. Do not invent IDs or expose privileged
   resource handlers to solve navigation.
7. `/material-3/buttons` is mapped to `components` by `MaterialRoute`, but only
   `components` is in the server allowlist; direct legacy buttons URLs can 404.
   Unknown client Material page IDs fall back to `overview`, while public unknown
   URLs return 404. Decide and test the intended alias contract.
8. The inspected router/product routes do not register a Google OAuth sign-in,
   callback or authenticated Google account API. Anonymous Google search is not
   OAuth qualification. Chrome profile backup/import does not establish OAuth
   registration, callback reachability, account sessions or token usability.
9. Prove connected chat/tools/model/kit behaviour through the actual authorized
   native or app-server boundary. The public site's explicit RPC-unavailable
   marker is currently consistent with its HTTP handler; inventing public API
   paths would hide the missing connection.

## Delivery follow-up: native Bun candidate

The delivery owner subsequently added the actual Bun entry point
`scripts/aphrody/site/aphrody.ts`, `packages/bun-m3/src/catalog.ts` and
`native-renderer.ts`. The table above records the earlier downloads-handler
baseline; the composed candidate resolves the following gaps without exposing
native desktop commands:

- `/terminal` now explicitly serves the existing UI shell for GET/HEAD.
- `/api/templates` serves a hash-pinned source catalogue with six actual entries:
  `base`, `web`, `react`, `desktop`, `hono`, `elysia`. `/templates/:id` serves a
  detail shell only for IDs present in that catalogue. Unknown IDs remain 404.
- `/api/docs` supports catalogue ID/category/query filtering, and
  `/assets/manifest` publishes the pinned public asset catalogue.
- `/api/m3/css` delegates validated sheet requests to the real Rust M3 renderer
  at `http://m3-renderer:3000`. The renderer validates CSS responses; failure
  returns 503. The private DBFR candidate returned CSS successfully. The compose
  draft gives the sidecar no published ports; its binary SHA-256 is
  `b09101771ae7396883e7f8a6223ea7d9010041351f6552aea399d9bed68936b3`.
- The composed server registers the actual Google OAuth owner, including
  `/auth/google/login`, `/auth/google/callback`, `/auth/session`, `/auth/scopes`
  and `/auth/logout`. The Google client is not verified/configured for live
  qualification; its deliberate unavailable response is 503. No account login,
  callback success or token usability is established by source registration.

The delivery owner rebuilt the UI from native Bun on current Aphrody source:
`var/site-build/bun-main-20261011`, 640 files and 30,589,587 bytes. The inspected
browser receipt `C:/bun/build/site-qualification/receipt.json` was refreshed at
2026-10-11T12:50:28 UTC: 20 page checks returned HTTP 200 with nonempty titles, with no
recorded exceptions. These checks used actual installed Chrome 154 at
`http://127.0.0.1:18804`; they do not qualify the still-compiling Bun Chromium
fork. The earlier 12:45 receipt covered 20 checks. The private DBFR candidate
also passed the delivery owner's 12 API/page checks. These are local/private
candidate observations, not an Internet production cutover receipt. The source
compose remains the delivery owner's concurrent deployment draft.

The fixture AI demo, native/app-server RPC and event connection, individual
Drive WASM methods, privileged models/kits, resource-specific detail routes and
legacy aliases still need their own behavioral qualification. Successful page
rendering and truthful unavailable notices do not establish those capabilities.

## Primary source evidence

- `m3/packages/app-ui/src/router.tsx`, `desktop-navigation.ts`, `App.tsx`:
  routes, aliases and selected Drive transports.
- `m3/packages/app-ui/src/routes/product/index.tsx`, `catalog.ts`,
  `ProductSearchHome.tsx`, `material/pages/Ai.tsx`: catalogue requests, theme
  scheme source, search wiring and the explicit AI fixture.
- `m3/packages/app-ui/src/tauri-bridge.ts`, `kit-bridge.ts`,
  `backend-inventory.ts`, `codex-chat.tsx`: actual bridge commands and RPC methods.
- `packages/infra/product/src/downloads/server.ts` (moved from Workspace on 2026-10-13): `APP_UI_ROUTES`,
  `appUiResponse`, `appUiDocsResponse`, `publicSearchResponse`, `createHandler`.
- `m3/packages/app-ui/build.ts`: generated public home/docs artifacts.
- `m3/packages/m3-theme/src/index.ts`: `httpSchemeSheet` requests `/api/m3/css`.
- `crates/ui/app/src/lib.rs`, `models.rs`, `studio.rs`, `kits.rs`: registered
  native owners and loopback local-model invocation.
- Bun `packages/bun-aphrody-web/integrations/m3/packages/app-ui/src/google-search.ts`
  and `webos-backend.ts`: canonical migrated source behind Aphrody forwarders.
  `packages/bun-aphrody-web/integrations/m3/packages/app-ui/webos.ts` delegates
  to `packages/bun-webos/server.ts` on loopback with host access disabled by
  default; that separate host is not the public downloads API.

No UI/backend source, deployment, authentication store or host configuration was
modified by this audit. Production HTTP and real Chrome checks belong to the
delivery owner's separate receipt.

Core source SHA-256 values at inspection:

| Source                  | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| UI router               | `ECC2E09100761838A6204951D104ADE28D75FCBC73738ABBB426811481555FBC` |
| Public downloads server | `F02EC3CC35EBE6B7D579A4E9050B92469CF687F19B66898B7818199963352BD0` |
| Product route component | `9F284A81391681B53518D8606C3FE3BB7D0869922E79980B9ABCA5C6E6B6DDA8` |
| Tauri/app-server bridge | `E8F8F1A1F9EA3E72400CDC1795F129D4A8AC300DE528329505019C1DD1756BCC` |
