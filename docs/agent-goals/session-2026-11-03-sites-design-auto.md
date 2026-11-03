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

## auto → Neon: done (2026-11-03 22:32 UTC cutover)

- Neon project `auto` (small-forest-38471112, aws-eu-central-1, PG 18); branches `main` (prod) and snapshot
  `avant-bascule-20261103t223215z`; roles auto (owner), auto_app, auto_worker (RLS). 73 tables, row counts and
  RLS/policies/grants/sequences verified identical before the switch. auto-pg-prod untouched (rollback: restore
  ~/auto/prod.env.avant-neon-20261103T223215Z then `release-vps.ts 20261025T023530Z-20eda31f relancer`).
- auto commits e4d5539, 814e66d, 9f2810c, 2b116f9, 227a509: npm @aphrody/* 1.4.7, packages/ui on m3-tokens,
  scripts/neon.ts, Cloud Run removed, CI ephemeral Neon branch per run, backups from Neon, /health {ok,version,commit}.
- Lane spec for the peer: env file ~/auto/prod.env (DATABASE_URL pooled, DATABASE_URL_DIRECT, AUTO_*, S3_*);
  ~/auto/neon.env release-only; health https://auto.aphrody.com/health field `commit`.
- Open: next auto release blocked until the crates.io agent's Cargo changes land (pdfcraft-create not found);
  bun-os bug: vendor/bun-ui/packages/bun-plugin-tailwind/package.json requires m3-tailwind/m3-tokens ^3.3.7 →
  fix range and republish 1.4.8; auto CI rust job still fails at setup.

## auto suite crates → crates.io: stopped early, resume here

- Published: aphrody-hayro-jbig2@0.3.0, aphrody-hayro-syntax@0.7.2 (plus earlier: aphrody-rag-core 1.4.7,
  deckcraft-* + craft-metafile 0.6.1, pdfcraft-cos/fonts/model/crypt/filters/content + aphrody-pdfcraft-forms 0.7.1).
- bun-os commits 6d4fa46acc (hayro/lopdf forks renamed aphrody-*, patch.crates-io removed, pdfcraft-preflight
  restored as a crate), 878595c1e3 (designcraft-pdf krilla-hayro-syntax), e5456911dd (Cargo.toml.orig removed).
- Remaining publish order (VPS script ~/tmp/publish.sh, own CARGO_HOME ~/tmp/cargo-home-publish, skips published,
  waits on rate limits, hours long): aphrody-hayro-interpret, aphrody-hayro, aphrody-lopdf; gridcraft core, formula,
  functions, numfmt, model, calc, xlsx; pdfcraft preflight, render, annot, create, organize, sign, edit, redact;
  wordcraft geom, doc, docx, fonts, proof, layout, pdf.
- auto switch prepared but NOT on main: aphrody-labs/auto ref `refs/wip/suite-crates-io` (79ef627811, parent
  a5bfc23). After publishing: rebase onto auto main, regenerate Cargo.lock, cargo fmt/clippy/test --locked, docker
  build app.Dockerfile, push; also drop the vendor step from auto package.json "vendor" and scripts/prod.ts.
  auto main still builds from vendor/bun-distribution (working tree restored, clean).
- Known: krilla now uses upstream hayro-syntax without the PdfCraft hardening; bun-os workspace resolution hit a
  crc version conflict (uucore vs aphrody-dust-core) unrelated to this work.
- Then tell bun-os-6c (peer) so it builds the auto delivery lane.

## Final state (2026-11-04 ~00:25)

### Design-system migration workflow: stopped on the owner's request
- 23 batch results recorded: several passed adversarial verification (e.g. commits 2ce0c7a474, c14686ae50), most
  are partial, some failed verification. Commits of each batch are on main; the run journal is at
  ~/.claude/projects/C--src-bun-os/b5fe0aa5-8e2a-4599-8793-5d6c70ec6b80/subagents/workflows/wf_bbd2babe-6a5/journal.jsonl.
- Interrupted, uncommitted batch edits (316 files) saved WITHOUT touching the working tree at
  `refs/wip/design-migration-20261104` (6d4e2d3eef) on origin. To resume: review that diff per batch, commit the
  coherent parts with scripts/git-commit-paths.ts, discard the rest; then rerun the workflow with resumeFromRunId
  wf_bbd2babe-6a5 (completed agents replay from cache) or relaunch only the failed/partial batches.
- docs/DESIGN-SYSTEM.md (the spec) is still to be written from the synthesized spec (ds-spec.md in %TEMP%; the
  understand workflow wf_7d939d48-215 journal holds it if %TEMP% is cleaned).

### ui-ux-pro-max: done (17299e48d7)
- Fork aphrody-labs/ui-ux-pro-max-skill synced (17ce720, upstream 713eef5), vendored at vendor/ui-ux-pro-max-skill.
- packages/m3-design: `bun run sync:upstream`, 43-query golden parity with upstream Python, stacks iced-libcosmic and
  egui, brands generated from @aphrody/m3-tokens (product seed #8c6c88), generated skill at
  packages/m3-design/skill/ui-ux-pro-max (`bun run build:skill`).
- Left: m3_design_* MCP tools lack rtl/dials/persist/structured results; user-level ~/.claude/skills copy is still
  upstream Python: install from the generated skill or ship it in the plugin.

### 3dviz-pro-max: done (fbbf252bad, fba7f0ae87, 570629ee60)
- Fork aphrody-labs/3dviz-pro-max, vendored vendor/3dviz-pro-max at d077e0e6; new owner packages/viz3d
  (@aphrody/viz3d): 12 Python scripts ported to Bun, golden parity with upstream, Three.js 0.186 WebGPU + WebGL2
  fallback kits, Bun scaffold, MCP tools viz3d_* in packages/m3-mcp, generated skill at
  packages/viz3d/plugin/skills/3dviz-pro-max.
- Left: Blender hero-tier bake not exercised; 37 studies still WebGL + own CSS; factory/bunos/components.json entry
  (peer scope); pre-existing packages/chromium type errors.

### Next: plugin distribution
- Build one Claude Code + Codex plugin from packages/m3-design/skill/ui-ux-pro-max + packages/viz3d/plugin +
  packages/m3-mcp, publish the bun-os repo as a marketplace, enable it in every aphrody-labs repo and on
  workstation + VPS.
