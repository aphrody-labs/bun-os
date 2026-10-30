# Active owner delivery backlog

Status: active, updated 2026-10-20. This ledger supplements the canonical
[consolidation goal](bun-os-consolidation.md). Unchecked work remains requested;
newer requests extend this scope rather than silently replacing it.

## Workspace and distribution

- [ ] Finish inventory of every crate, package, app, vendor and submodule, including sparse/missing sources.
- [ ] Consolidate all existing worktrees and branches into the canonical checkout after preserving changes in Git; create no new worktrees.
- [ ] Finish source checkpoints and PC/VPS/forge/GitHub synchronization, including concurrent changes.
- [ ] Finish flattening and owner migration without losing histories, licenses, notices or consumers.
- [ ] Retire confirmed legacy/duplicate sources only after their consumers migrate.
- [ ] Complete shared factory, cache, target, release and packaging ownership.
- [ ] Qualify Server, COSMIC Desktop and Gamescope Gaming compositions, including CachyOS/ChimeraOS/Omarchy integration and pacman/libalpm.

## One product

- [ ] Complete integration of App UI, Aphrody App, WebOS, Drive, Craft and Bun packages into one superapp/site.
- [ ] Inventory every public Aphrody site and subdomain against its canonical source owner, build artifact and active production target; route each eligible host from the real owner source rather than stale or generic content. Live Cloudflare state confirms 35 Aphrody WebOS hosts across `aphrody.com` and `aphrody.app`; other Aphrody owners/domains still need reconciliation.
- [ ] Add one authenticated, receipt-producing automatic deployment flow for eligible sites, triggered by canonical source updates and deployable builds; keep independent owners and protected credentials intact. The WebOS command gates on a clean, pushed `os` commit, builds on the VPS with Bun 1.4.4, declares all 35 routes/domains, verifies every host and writes a source-bound receipt. Deployment `e2c45d0bd20d47c7915596448e89c68543e87e9f` is live and all 35 host checks returned HTTP 200; a fresh read-only probe also returned HTTP 200 for all 35 configured hosts. `.gitea/workflows/aphrody-sites.yaml` deploys on every `os` push; an hourly schedule is present only in the current uncommitted checkout, so it is not active in production yet. The published workflow still needs a successful run proving the protected `CLOUDFLARE_API_TOKEN` is configured. `apps/webos/deploy.ts` checks WebOS host ownership and keeps `aphrody-app` private behind a service binding. This workflow publishes WebOS only; Craft, the separate Bun runtime site, downloads, and other independent site owners still need adapters and host-by-host reconciliation.
- [ ] Reconcile the latest SpaceDrive engine/client/mobile source against the active Bun OS owners; restore every compatible missing Drive capability through `packages/app-ui`, `@aphrody/m3-explorer`, `@aphrody/drive-client`, `crates/aphrody-drive` and `sd-daemon`, while retaining version-specific upstream licenses and an explicit disposition for each incompatible host path.
- [ ] Wire `sd-daemon` into the actual cross-platform desktop release build and install flow; `tauri.drive.conf.json` exists, but target-suffixed sidecar staging and packaged startup are not yet proven. Integrate and qualify Drive Files workflows in the unified Android host as well.
- [ ] Finish adopting the common M3 design system and UI UX Pro Max across all consumers.
- [ ] Finish serving, documenting and installing Bun Engine, Bun RE, REA and Replica with the product.
- [ ] Complete CLI, MCP, plugin, WASM, FFI and Docker coverage; retain an explicit unsupported-capability list until qualified. The `bunos-gaming` image no longer performs unpinned AUR clones or uses `makepkg --skippgpcheck`; its package installer now fails with an explicit missing-package list when the configured repositories lack a requested emulator/game package. The `/usr` builder and game image now share the root Arch bootstrap digest. A fresh local image plan reports `factory/usr/locks/gaming.json` missing and blocks image builds until the `/usr` composition is built and qualified. Repository snapshots, local Bun OS package signatures/receipts, missing package admission and VPS qualification remain required before release.
- [ ] Converge Bun Video's newly absorbed FilmCraft 0.9 owner and the distribution's retained FilmCraft 0.7.2/PhotoCraft 0.8.2 consumers without copying or deleting source owners prematurely; coordinate with the active Bun Video session.
- [ ] Complete import/API repairs, decoder fixes and performance qualification across affected owners.
- [ ] Verify requested services on their intended hosts; WireGuard was started, other stopped services have not been blanket-enabled.

## Dust, games and public delivery

- [ ] Compile and qualify Dust's actual WGPU 30 renderer through the shared Bevy device, not only CPU pixels presented with WebGPU.
- [ ] Qualify shared texture presentation, lifecycle, input/touch/controller/audio and save/load behavior in the browser.
- [ ] Build every supported emulator WASM recipe and qualify each exact variant before publication.
- [ ] Package qualified cores with required redistributable BIOS, source-licensed test ROMs, hashes, receipts, notices and corresponding-source information.
- [ ] Test the owner-supplied Inazuma Eleven 2 archive on the VPS; its source path is `usr/share/rom/`, not `usr/share/roms/`.
- [ ] Prepare separately identified owner-authorized proprietary content. The owner declared Level-5 and Bandai Namco distribution agreements; do not relabel these games as open source or invent contract/end-user license terms.
- [ ] Integrate supplied DBXV2 artifacts when available; no new DBXV2 binary was supplied with the Inazuma archive.
- [ ] Finish the common M3 gaming route and absorb `play.aphrody.app` into the unified site while preserving supported emulator URLs.
- [ ] Qualify Gamescope launch on the actual gaming composition/session.
- [ ] Deploy and verify public gaming pages/assets without authentication or IP allowlists. Keep administrative credentials and unrelated private stores outside gaming artifacts.

## Evidence and current limits

The WebOS/App UI assembly previously succeeded on the VPS. Native Bun checks and
HTTP checks passed for the common workspace assets and backend-unavailable
responses. These do not establish complete product or GPU qualification.

The old Dust artifact failed fresh VPS qualification: 23 frames in 90 seconds,
then 29 frames with a 600-second deadline, against a 120-frame requirement.
No valid public qualification receipt was issued. The new GPU source integration
is being checked separately. Source commits are checkpoints, not release proofs.

All builds and qualification run on the VPS with existing serialized factory
owners and at most four compiler jobs per lane. Preserve concurrent source work,
protected stores and existing licenses throughout.

Cross-session coordination was explicitly authorized by the owner on 2026-10-20.
Coordinate Bun Video, Shenron recovery and Craft/M3 changes before touching their
owned paths or factory lanes. Preserve their source checkpoints during sync.
