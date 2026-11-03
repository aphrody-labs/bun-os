# Handoff: sites, design system, auto, skills (session of 2026-11-03)

Resume from this file. Peer session `bun-os-6c` owns infra/, factory/, crates/bunos-*, packages/bunos-*,
packages/bun-windows-winclean and the VPS deploys (its open list: docs/agent-goals/full-deploy.md). Everything
else below is this session's scope. Commit only with `bun scripts/git-commit-paths.ts`; never commit the
workstation Cargo.lock wholesale (the VPS lock writer bunos-sync regenerates it).

## Done and pushed

- aphrody.com (crates/aphrody-webos-server site.rs/site.js/site.css, crates/aphrody-webos-client/web/index.html):
  SEO (robots, sitemap, security.txt, JSON-LD, OG/X), llms.txt + llms-full.txt (rel=describedby), PWA manifest +
  service worker + offline page, /privacy storage manager (Clear-Site-Data), static share links, WebGPU probe, M3
  /site.css from aphrody-m3-tokens, accessibility pass. Commits 0cadc5f504, 31a8b600a4, e0d1cb0cbe.
- Server hardening (72e9b52a82): SIGTERM drain, timeouts, load shedding, problem+json/HTML errors, request IDs,
  readiness. Live and verified.
- Blank page root cause: iced fork unset VK_LOADER_DRIVERS_DISABLE on wasm32 (panic). Fixed in aphrody-labs/iced
  243c35a6b, aphrody-labs/libcosmic 3abe177e; client/chat/search pinned in baae01d130 with a panic hook and a
  landing fallback. Verified locally in Chrome (libcosmic UI renders).
- Aphrody identity on aphrody.com (dc4934a406): Byron Love icon set, portrait share card, title "Aphrody", pet
  idle animation (crates/aphrody-identity/assets/aphrody/sprites/idle.webp) at the centre. Verified locally.
- m3-fonts: Google Sans Flex 1.9 MB -> 173 KB, Roboto Flex 509 -> 132 KB by pinning unused axes (065136efae,
  2096b46636).
- creator.aphrody.com and craft.aphrody.app SEO/404/llms/manifest (5777a638f2, dac93f808c, 4357f2ded8); vhosts
  and deploys done by the peer.
- artcraft-web-app test preload TS1375 (5f00f35c40).
- Neon: NEON_API_KEY in bun-os/.env, auto/.env, Windows HKCU + Credential Manager, VPS
  ~/.aphrody/private/env/dev.env + ~/.config/environment.d/60-neon.conf, GitHub secret on aphrody-labs/bun-os and
  aphrody-labs/auto; NEON_ORG_ID org-long-shape-78978832 everywhere (variable on GitHub). User-level `neon` MCP
  (bearer key) connected; neon CLI 8.18.
- auto (aphrody-labs/auto): main fast-forwarded from codex/fournisseurs-chantiers (a5bfc23).

## Pending: needs a release

- aphrody.com release from main after bunos-sync pushed a Cargo.lock with libcosmic 3abe177e (asked the peer).
  Then verify in real Chrome: client renders, title "Aphrody", favicon Byron, pet centred, /pet-idle.webp 200.

## Still running when this session ended (check results; rerun if lost)

- Workflow design-system-migrate (run wf_bbd2babe-6a5, script under the session workflows dir): 24 batches B0..B23
  from the synthesized spec (/tmp ds-spec.md / ds-synth.json, regenerate with the design-system-understand
  workflow wf_7d939d48-215 if lost). Resume with Workflow({scriptPath, resumeFromRunId}). B23 touches the
  aphrody.com site files: it must keep the identity work above (Aphrody name, icons, pet).
- Agent: auto suite crates to crates.io (publish 14 unpublished gridcraft/pdfcraft/wordcraft/deckcraft crates +
  closure from the VPS where the cargo token lives; patched hayro/lopdf as aphrody-hayro*/aphrody-lopdf), then auto
  Cargo.toml on registry versions, drop vendor/bun-distribution + suite.toml.
- Agent: auto npm upgrade (@aphrody/* latest), Neon project "auto" (verified pg_dump/restore with row counts, then
  cutover with auto-pg-prod kept as rollback), retire Cloud Run code, Neon helpers in one module, CI ephemeral
  Neon branch per run. Production target: VPS + Neon; later add a Cloudflare + Neon + R2 deploy target.
- Agent: ui-ux-pro-max fork sync (aphrody-labs/ui-ux-pro-max-skill was 12 behind) + Bun port in
  packages/m3-design + m3-mcp tools + generated skill dir.
- Agent: 3dviz-pro-max fork to aphrody-labs + Bun port of its 14 Python scripts + viz3d MCP tools.
- Agent: iced exploration (read-only report of improvements for our iced/libcosmic setup).

## Next steps not started

1. Distribution of skills: make the bun-os repo a Claude Code + Codex plugin marketplace (one design plugin with
   ui-ux-pro-max + 3dviz-pro-max + MCP) and enable it in every aphrody-labs repo and on workstation + VPS (today
   ~/.claude/local-marketplaces/bun-os is local only).
2. Owner request: Aphrody identity icon (crates/aphrody-identity/assets/brand) for every Windows/Linux app icon
   and README header across the monorepo; upload all Aphrody assets to R2 and the VPS (Cloudflare via MCP).
3. downloads.aphrody.com: replace the 1.47 MB /pet.webp atlas with sprites/idle.webp (packages/product/src/
   downloads/server.ts, after the design batch B22).
4. Remove Google Analytics + Clarity from apps/artcraft-web-app/app/index.html (third-party trackers on
   craft.aphrody.app/art/), after design batch B18.
5. Apply the iced exploration report (forks aphrody-labs/iced, aphrody-labs/libcosmic; bun-os consumers).
6. Komodo (deploy.aphrody.app 502): mongo WiredTiger corruption, 248 GB, /home 91% full; owner decision pending
   on backup-then-repair (copy to another host or btrfs snapshot first).
7. Repo-wide `bun format` (about 6700 files fail the gate) once the migration lands; auto-deliver stays
   skipped-red until the gate is green.
8. Pre-existing: m3-fonts upstream sync test fails on Windows by one byte (CRLF in material-symbols/index.d.ts).

## iced exploration report (done, not applied yet)

Priorities from the read-only comparison of upstream iced/libcosmic with our forks and consumers:
1. No WebGL2 fallback on aphrody.com: the client's wgpu 28 lacks the `webgl` feature, so browsers without WebGPU
   fall to tiny-skia CPU. Add `webgl` (libcosmic fork feature forwarding iced/webgl, or wgpu features=["webgl"] in
   the client wasm deps); test navigator.gpu present but requestAdapter failing.
2. Stream frames: replace VideoFrame -> 2d canvas -> getImageData -> image::Handle (GPU readback + atlas churn every
   frame) with a shader widget owning one wgpu texture fed by queue.copy_external_image_to_texture; JPEG/PNG via
   createImageBitmap, drop the `image` dep (keep Handle path for tiny-skia).
3. Keep only the latest frame (web.rs:245 unbounded mpsc + 64-deep channel queue latency).
4. Request the stream at physical size (track window::Event::Rescaled; lib.rs:130-133,187-192, input.rs:82).
5. Wasm size 8.87 MB (2.38 MB br): gate libcosmic EMBEDDED_FONTS (~2.1 MB) and the 677 embedded cosmic-icons
   (~0.9 MB, libcosmic build.rs) behind features; release.sh builds without LTO: use `--profile web-craft`.
6. Cherry-pick iced-rs fixes into aphrody-labs/iced: b54f2c599 (event-loop spin, 50-85% CPU per keystroke in
   chat/search), 8e05eade2, 08eb93ad4, c197a4cea; rebase iced on pop-os 229186b and libcosmic on pop-os master
   (12 behind). Cargo.lock carries wgpu 28 + 30 (two copies).
7. Client theme: cosmic::Theme::dark() uses a different seed than the page; build it from aphrody-m3-tokens via
   libm3::cosmic (drop libm3's forced tokio feature so wasm can use it).
8. libm3::cosmic::themed() rebuilds the theme on every call: cache one theme per (seed, mode).
9. Install console_log/tracing-wasm on wasm; add a panic hook to cosmic-calculator.
10. release.sh: replace wasm-opt --all-features and +relaxed-simd with explicit, verified features.
11. vendor/cosmic-epoch/libcosmic is stale (de9353ab, iced submodule not checked out); cosmic-calculator cannot
    build from it: repin to the fork rev used elsewhere.
12. Dev tools: forward iced tester/hot/time-travel through libcosmic; add iced_test snapshot tests.
