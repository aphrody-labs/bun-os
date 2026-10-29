# Provenance of the Bun OS AI layer (LU)

The AI layer of Bun OS is **Locally Uncensored (LU)**, an open-source Tauri desktop studio for
local chat, image and video generation, a coding agent, computer control and voice.

| | |
|---|---|
| Upstream | https://github.com/PurpleDoubleD/locally-uncensored (default branch `master`) |
| Fork | https://github.com/aphrody-labs/locally-uncensored (tracks upstream `master`; never force-pushed) |
| Imported commit | `5c9c4441c9cfd7240ee05ae4bb597077e8d89ff8` (2026-10-28, "docs: README roadmap after 3.0.8 release"), app version 3.0.8 |
| Licence | **AGPL-3.0-only** (full text in `apps/lu/LICENSE` and `crates/lu-native/LICENSE`) |

## Licence handling

* LU is AGPL-3.0-only. The owner accepted the licence. Bun OS is open source and publishes this
  source tree, so the network-use clause (section 13) is satisfied by the public repository
  `aphrody-labs/bun-os`; a modified LU that users reach over a network must keep pointing at it.
* `LICENSE` is kept verbatim next to the code (`apps/lu`, `crates/lu-native`). Cargo manifests keep
  `license = "AGPL-3.0-only"`, `package.json` keeps `"license": "AGPL-3.0-only"`, the upstream
  author field and every per-file notice are untouched.
* The rest of the monorepo keeps its own licences (MIT / Apache-2.0). The AGPL scope is exactly:
  `apps/lu/**`, `crates/lu-native/**`, `docs/ai/**` (except this file and the Bun OS additions listed
  below), `factory/ai/scripts`-derived files in `apps/lu/scripts/**`. Bun OS-original files
  (`packages/bunos-ai/**`, `factory/ai/*.ts`, `factory/bunos/pkgbuilds/bun-os-ai/**`) are MIT.
  Linking: the AI service talks to LU only over HTTP, never links LU code.
* Third-party notices of LU (`docs/ai/third-party/*.md`) are kept; the models and Python packages
  they list are downloaded by the user at run time, not shipped.

## Layout

| Upstream | Bun OS |
|---|---|
| `src/`, `dev-server/`, `public/`, `e2e*`, `logos/`, vite, vitest, tsconfig, eslint, playwright configs | `apps/lu/` (Bun workspace `@aphrody/lu`) |
| `src-tauri/` | `apps/lu/src-tauri/` (Cargo workspace-excluded, own lockfile, see below) |
| `src-tauri/plugins/lu-native` | `crates/lu-native/` |
| `scripts/` | `apps/lu/scripts/` (kept next to the tests that import them) |
| `mobile-client/`, `mobile-tests/` | `apps/lu/` (documented, not built, see `README.md`) |
| `mobile-docs/`, `third-party/`, root `*.md` | `docs/ai/` |
| `package.json` | rewritten as `apps/lu/package.json` (Bun scripts, root catalog for react / tailwind / @types) |

Not imported: the `docs/` marketing site of lu-labs.ai (pricing, cloud, SEO pages), `.github`,
`.signpath`, signing and release scripts, `setup.*`/`start.bat`/`update.bat` (replaced by
`factory/ai/setup.ts`), `package-lock.json`. The exact mapping is `factory/ai/lu-map.json`.

## Changes against upstream (everything else is verbatim)

1. **LU Cloud disabled.** `apps/lu/src/api/cloud/config.ts` no longer defaults to `lu-labs.ai` and the
   author's Supabase project; `CLOUD_ENABLED` is false unless a build sets `VITE_LU_CLOUD_URL`,
   `VITE_LU_SUPABASE_URL` and `VITE_LU_SUPABASE_ANON_KEY`. `cloudFetch`, `getAccessToken`,
   `supabaseCloud` and the status poll fail closed before any network call. Both hosts were removed
   from the CSP (`tauri.conf.json`) and from `CSP_DIRECT_HOSTS`.
2. **Updater off.** The `plugins.updater` block (author's endpoint and minisign key) is removed; the
   plugin is registered only with the Cargo feature `self-update`; `updateStore.checkForUpdate` needs
   `VITE_LU_SELF_UPDATE=1`, and its release feed is the fork. Updates ship through pacman (`bun-os-ai`).
3. Signing / release / marketing tests that exercised dropped files were removed (listed in `lu-map.json`).
4. Bun OS defaults: see `docs/ai/BUNOS-AI.md`.

Remaining references to `lu-labs.ai` in comments, tests and the `plugin_rea` self-protection list are
harmless strings (no request is made); remaining outbound hosts are the model sources the user asks
for (huggingface.co, civitai.com, ollama.com, download.pytorch.org) and the optional BYO-key providers.

## Resync

```sh
git clone https://github.com/aphrody-labs/locally-uncensored /tmp/lu   # after syncing the fork with upstream
bun factory/ai/lu-sync.ts /tmp/lu            # preview: lists every file that differs
bun factory/ai/lu-sync.ts /tmp/lu --write    # copy, then re-apply / review the changes listed above
git -C /tmp/lu log --oneline 5c9c444..HEAD   # what changed upstream
```

Sync the fork itself with `gh repo sync aphrody-labs/locally-uncensored --branch master` (fast-forward
only). The files listed in "Changes against upstream" will show up as differing: merge by hand.
Update the commit hash in this file after each resync.
