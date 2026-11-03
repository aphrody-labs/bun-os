# Goal: full deploy

Everything Bun OS ships is built once on the VPS, qualified, published and verified from outside, with every
claim in docs/PRODUCT.md backed by a receipt. Stop only when every box below is checked or is explicitly owned by
the owner (listed under "Owner-only").

## Done criteria (each one is verified, not assumed)

### Delivery
- [x] WebOS (aphrody.com) deployed from main; `curl https://aphrody.com/api/health` reports the deployed commit.
- [x] Kernel `linux-bun` 7.4-rc1: Android 17 config check clean, Bun PID 1 boot (plain and `BOOT_MODE=android`),
      published signed in `[bunos-testing]`, 7.3.1 archived.
- [x] ISO `bunos-2026.11.03-x86_64`: built, booted under QEMU/OVMF to the COSMIC greeter, published at
      aphrody.com/downloads/os/ with sha256, b2sum, signature, receipt and screenshot.
- [x] craft.aphrody.app redeployed (aphrody-ffi built on the VPS: `APHRODY_FFI_DEV=1 APHRODY_FFI_LIB=/var/cache/aphrody-target/lane-0/release/libaphrody_ffi.so`; `/llms.txt` and
      `/site.webmanifest` return 200).
- [ ] Gate green on main: `bun check`, `bun lint`, `bun format`, `cargo check --workspace --locked` (format debt
      is the blocker: about 6700 files; fix with the repo wrapper once the design-system migration in the other
      session has landed). Auto-deliver then runs by itself.
- [ ] Every public host answers (no 502, timeout or 404 at the root). Diagnosed by the agy sub-agent
      (read-only, 2026-11-03), repository decisions already taken:
      - control.aphrody.app: decommissioned on purpose (eef485d3b8, no DNS record): not a target.
      - store.aphrody.com: ghost CORS origin, removed from infra/fleet/api.toml and the generated gateway.conf.
      - aphrody.com/store: not a promise anywhere in docs/apps; the Store is served at /repo/, /npm/, /cargo/,
        /downloads/os/ and /api/store/: not a target.
      - omar.aphrody.com: DONE 2026-11-03: proxied CNAME to aphrody.com (was A 10.200.77.10), vhost enabled,
        403 from the VPS and prod.
      - api.aphrody.com/ and cdn.aphrody.com/: DONE: 302 to /v1/ and /s/manifest.json (fcbd61a866).
      - nie.aphrody.app: owner decision (game depot missing on the VPS, RG_CORE_MODELES=0): decommission or restore.
      - `user@1001.service` on the VPS: DONE (reset-failed; `systemctl --failed` is empty).
- [ ] Komodo (deploy.aphrody.app): Mongo data directory backed up, repaired or recreated, service healthy.
      Needs the owner's decision on the 248 GB WiredTiger data (see Owner-only).

### Product (docs/PRODUCT.md rows still not done)
- [ ] #12 aphrody.com serves the desktop session. Step done 2026-11-04: the repo unit of aphrody-webos is installed
      (WEBOS_SESSION = the Android 17 gateway on 127.0.0.1:8799, native mode, token /etc/aphrody/android.token), so
      `/api/health` reports `session ok true` and the client now says "Sign in with the Bun OS owner Google account
      first" (sessions are owner-only). Still open: (a) verify the stream after an owner sign-in (owner action:
      Google sign-in), (b) run the unified COSMIC session container (`bunos-unified:session`, contract in
      docs/UNIFIED-IMAGE.md, gateway :8794, token /run/secrets/session.token) as a service and point WEBOS_SESSION at
      it; the container `sleepy_cori` running for 15 h is an old test without a token (stream gateway not started).
      Then the client items of docs/agent-goals/session-2026-11-03-sites-design-auto.md (iced report).
- [ ] #9 Android 17 in the session reaches a booted state (nightly qualification passes); unblocks #10.
- [ ] #23 apt feed `aphrody.com/repo/apt` answers (404 today); #26 row updated to point at the published ISO.
- [ ] #33 OpenAPI for every HTTP service (3 of 79 today); #36 crates and npm publication finished.
- [ ] #14, #15, #17 stalled lanes restarted or closed with a reason.

- [ ] auto (auto.aphrody.com) on the delivery pipeline: lane in factory/automation that builds aphrody-labs/auto main
      and releases it with `scripts/release-vps.ts <release> relancer` (needs `bun run build:native`), env names in
      ~/auto/prod.env (values never printed), migrations by the release against DATABASE_URL_DIRECT, health gate on
      https://auto.aphrody.com/health (`commit` field; the live image only returns {"ok":true} until the next release),
      rollback = restore ~/auto/prod.env.avant-neon-20261103T223215Z and release 20261025T023530Z-20eda31f. Neon cutover
      done 2026-11-03 22:32 UTC; auto-pg-prod stays as rollback. Blocked until the crates.io agent's Cargo changes land
      (pdfcraft-create not resolvable yet). Spec detail: docs/agent-goals/session-2026-11-03-sites-design-auto.md.

### Windows (native, no resident layers)
- [ ] `bunos-wsl-service.exe` installed on the workstation; `.wslconfig` without `instanceIdleTimeout=-1`;
      BunOSWsl and BunOSWinBridge start on demand (service trigger).
- [ ] Icon, VERSIONINFO and manifest on every Bun OS binary; AUMID and Start shortcut.
- [ ] `look.accent` drift gone: rebuild `bunos-win11`, re-apply, `verify` clean; `undo` tested live.
- [ ] `tcp::tests::live_table_lists_a_bound_listener` made environment-aware (this Insider build reports an empty
      state for loopback listeners).

## Rules
- No stubs, scaffolds or placeholder text anywhere; every feature works end to end against its promise.
- Commit only through `bun scripts/git-commit-paths.ts -m <msg> <paths>`, as aphrody-dev, on main; never force,
  never `reset --hard` or `clean`.
- Credentials stay in the protected stores and are never printed. Preserve `.local` stores, sessions, databases and
  model weights. Cloudflare changes go through the Cloudflare MCP.
- Host changes go through the repository (infra/, factory/automation); manual applies follow the same backup,
  `nginx -t`, reload and rollback steps as the delivery lane.
- Never reboot the workstation; never touch Defender, Windows Update, WSL/Hyper-V, Store, WebView2 or the owner's apps.

## Owner-only (not blockers for the rest)
- Approve the 4 staged npm packages with 2FA on npmjs.com.
- Komodo's Mongo data: back up and repair, or start empty.
- Disable Secure Boot for `bunos.sys`; EV certificate for the attested driver; logoff/reboot test of BunOSWsl.
