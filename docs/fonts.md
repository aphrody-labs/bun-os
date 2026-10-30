# Shared font assets

Bun OS now owns the distribution workspace integration of the shared Craft font
crates and assets. The crates are members of the root Cargo workspace:
`crates/craft-fonts` owns the manifest, runtime lookup and optional embedding;
`crates/craft-fonts/tests` verifies font bytes, licenses, names and coverage.
Assets and their individual licenses live under `fonts/`; source pins, hashes and
attribution are recorded in `fonts/manifest.txt` and `ATTRIBUTION.md`.

The source project is `aphrody-labs/craft-fonts`. Its content was integrated
from the pinned source revision `3d9ab3a132ed0eff457e424226a435a901da30d3`.
The workspace integration branch `os` at
`f1bfd5fd75f24619cad085230c7290f17ee7821e` remains published in that repository
to preserve the source-side Cargo integration history. Each crate is now a
pinned Git submodule in the Bun OS root workspace, with its own preserved
split history on the private forge. `just setup` initializes these checkouts;
their manifests inherit the single parent Cargo workspace and nightly toolchain.

Font embedding is optional. Set `CRAFT_FONTS_DIR` to a checkout containing
`fonts/manifest.txt` for runtime lookup, or enable the crate's `embed` feature to
compile the fonts into an application. Each font's OFL notice travels with its
asset; the shared code retains its MIT OR Apache-2.0 notices.

See [integration guidance](integration.md) for consumer setup.
