> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Public M3 site and Google search publication

The product UI is owned by `m3/packages/app-ui` in Aphrody. The public search adapter is owned by `packages/bun-google/src/search.ts` in the Bun checkout; the anonymous SERP transport and parser remain the existing Rust Google owner. The adapter uses standard Bun process APIs and does not import `bun:google`, so the deployed Bun 1.4.3 server can load the pinned single-file module.

## Artifact and activation contract

From the Bun checkout, run `bun bd -j1 run ../aphrody/scripts/release/publish-app-ui.ts` to inspect the declared plan with the qualified native runtime. A build requires committed scoped sources in both checkouts. Set `APHRODY_BUN_CHECKOUT` when the Bun checkout is not the sibling `../bun`. `--build --public-assets` prepares an isolated artifact, reuses the existing Tauri API/identity/font owners, and verifies the transferred docs catalog against `packages/bun-aphrody-web/transfer-receipt.json`. `APP_UI_DOCS_CATALOG` may name only that canonical verified file; the deleted Aphrody catalog is not restored.

The manifest pins both source revisions, the transfer receipt hash, docs hash and Google search source hash. Each immutable UI release contains `google-search.ts` and a nonsecret `google-search.env` naming the declared `/home/ubuntu/.local/bin/aphrody` executable. The SDK and environment follow the same `app-ui/current` symlink as the UI, so rollback restores all three together. No credentials, account cookies, provider store or browser profile is copied into the release.

Install the source systemd unit through the existing Downloads Infra catalog workflow before applying the UI plan. It declares `EnvironmentFile=-/home/ubuntu/apps/downloads/app-ui/current/google-search.env`. The UI publisher refuses apply unless that declaration and the owner executable exist. The real service owner is `aphrody-downloads.service`, not a Docker Compose service.

After reviewing and committing the sources and artifact, use `--apply --artifact <artifact> --expected-server-sha <live-reviewed-sha>`. Existing native Infra SSH/SFTP transports perform upload and activation; the publisher validates SHA256SUMS, backs up the current server/declaration/symlink, restarts systemd and rolls back on health/UI smoke failure. The public Nginx catalog is applied separately by Infra. A successful artifact or service activation does not qualify Google network availability.

## Search behavior and measured boundary

`/api/search` is public GET only on declared site hosts. It accepts bounded query, language, start and result count, forces anonymous web SafeSearch, and never forwards caller Authorization or Cookie headers. The SDK calls the declared Google owner with `--no-auth --safe --transport fetch`; it does not discover credentials, refresh OAuth or fall back to a browser. The Rust owner sends constant consent preferences (SOCS; isolated HTTP mode also sends CONSENT), not account session cookies. Provider output, concurrency, runtime and decoded size are bounded. Upstream failure yields a redacted HTTP 503 rather than invented results.

Before the 2026-10-11 activation, the VPS service listened on loopback 8797 under systemd; its installed server SHA was `c1a6458707252e302e4679d021258ecdb40b8d5092c5ebbb3d5b74f2c9e22fba`. The apex Nginx configuration targeted DBFR `10.200.77.3:18803`, and the 8797 homepage was the earlier static download UI. The [verified publication record](public-google-search-publication.md) documents the subsequent server/UI/SDK activation and the remaining public routing boundary. Recheck changing facts before another apply. Anonymous Google fetch was blocked. Explicit isolated HTTP probes on Windows and VPS also returned Google anti-bot interstitials with no organic results. No transport fallback or live Google PASS is claimed.

## Qualification

Run the scoped publisher tests, SDK search tests and Downloads search-route tests through `bun bd -j1 test` in the Bun checkout. Run strict TypeScript on the publisher, scoped oxlint/oxfmt, and the actual isolated M3 artifact build. Check source receipt hashes, required UI/fonts/docs files, no privileged RPC declaration, and the pinned SDK bytes. Public activation then requires health, homepage/OS, deployed module source hash, `/api/search` status/body and apex routing probes. A measured 503 is honest network failure; it must remain visible until an anonymous Google owner transport actually qualifies.
