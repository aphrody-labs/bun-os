<!-- SPDX-License-Identifier: Apache-2.0 -->

# Offline Bun documentation

`aphrody-bun-docs` indexes the Markdown and MDX pages of `docs/` in upstream Bun (oven-sh/bun)
`oven-sh/bun` on the first tool call. It provides `bun_docs_search`, `bun_docs_read`,
`bun_docs_list` and the N2B registry's `bun_node_equivalent`. Aphrody keeps no copy of the docs:
`docs/reference/upstream-bun` only holds `SOURCE.json` (the pinned upstream commit), the Bun
`LICENSE.md` and `APHRODY-FORK.md`.

Corpus resolution, in order:

1. `APHRODY_BUN_DOCS`: an explicit docs directory. An invalid override returns an error instead
   of silently selecting a different corpus.
2. `docs/` of the fork checkout: `APHRODY_BUN_CHECKOUT`, else the `bun/` sibling of
   `APHRODY_WORKSPACE_ROOT` or `APHRODY_ROOT` (used when it holds `docs.json`).
3. A portable bundle at `<executable-directory>/bun-docs`.
4. An installation bundle at `<installation-prefix>/share/aphrody/bun/docs`.
5. The user data bundle at `$XDG_DATA_HOME/aphrody/bun/docs` (`$HOME/.local/share` by default;
   `%APPDATA%` on Windows).
6. A previous versioned download in `<data>/aphrody/bun/docs-<commit12>/docs`.
7. Otherwise the versioned download itself: a partial `git` clone of `docs/` (without its image
   directories, about 7 MB) at `APHRODY_BUN_DOCS_REF`, else the commit pinned in `SOURCE.json`.
   `APHRODY_BUN_DOCS_FETCH=0` forbids it; the tool then fails with the list of settings to fix.
   `bun packages/infra/workspace/src/bun-upstream-docs.ts --resolve` applies steps 1, 2, 5, 6 and 7 from Bun.

The index is cached per subsystem instance. Restart the host after replacing its
corpus. `bun_docs_list` includes the selected root, so callers can verify which
installed version they are consulting.

Validation: `cargo test -p aphrody-bun-docs`, `cargo check -p aphrody-bun-docs
--all-targets`, and `cargo clippy -p aphrody-bun-docs --all-targets -- -D warnings`.
