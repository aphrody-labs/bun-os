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
- [ ] craft.aphrody.app redeployed (needs a native `aphrody-ffi` build on the VPS; `/llms.txt` and
      `/site.webmanifest` return 200).
- [ ] Gate green on main: `bun check`, `bun lint`, `bun format`, `cargo check --workspace --locked` (format debt
      is the blocker: about 6700 files; fix with the repo wrapper once the design-system migration in the other
      session has landed). Auto-deliver then runs by itself.
- [ ] Every public host answers (no 502, timeout or 404 at the root): nie.aphrody.app, omar.aphrody.com,
      control.aphrody.app, api.aphrody.com/, cdn.aphrody.com/, aphrody.com/store, store.aphrody.com (DNS via the
      Cloudflare MCP or drop it from the CORS map). `user@1001.service` on the VPS clean.
- [ ] Komodo (deploy.aphrody.app): Mongo data directory backed up, repaired or recreated, service healthy.
      Needs the owner's decision on the 248 GB WiredTiger data (see Owner-only).

### Product (docs/PRODUCT.md rows still not done)
- [ ] #9 Android 17 in the session reaches a booted state (nightly qualification passes); unblocks #10.
- [ ] #23 apt feed `aphrody.com/repo/apt` answers (404 today); #26 row updated to point at the published ISO.
- [ ] #33 OpenAPI for every HTTP service (3 of 79 today); #36 crates and npm publication finished.
- [ ] #14, #15, #17 stalled lanes restarted or closed with a reason.

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
