<!-- SPDX-License-Identifier: Apache-2.0 -->
# SVG convergence: `aphrody-svg`

One owner for SVG across the workspace: the Rust crate
[`crates/ui/svg`](https://github.com/aphrody-labs/aphrody/blob/main/crates/ui/svg/README.md), its `bun:ffi` surface
(`bun_rs_svg` in `crates/ui/bun/src/svg.rs`) and the thin Bun package
`@aphrody/svg`. The owner is `aphrody-ui`: it is the 2D rendering layer and
already hosted the icon, identity and sprite crates the other repos consume by relative path.
It does not depend on `aphrody-ai`.

## Capabilities

| Need | API (Rust / Bun) |
| --- | --- |
| Untrusted SVG cleaning | `sanitize::sanitize` / `sanitize()` |
| `viewBox`, intrinsic size, resizing | `viewbox::{geometry, normalize}` / `geometry()`, `normalize()` |
| `currentColor`, `var(--md-sys-color-*)`, colour remaps | `theme::{Theme, apply}` (`Theme::m3`) / `theme()` |
| `<symbol>` sprites with prefixed ids | `sprite::{sprite, symbol, use_ref}` / `sprite()` |
| Font glyph → SVG path | `glyph::{glyph_outline, SvgPathPen}` / `glyph()` |
| Optimization (usvg normalizing writer) | `optimize::optimize` / `optimize()` |
| SVG → RGBA / PNG / ICO | `raster::{render, render_png, render_ico, pack_ico}` / `renderRgba()`, `renderPng()`, `renderIco()` |
| Pixel diff | `diff::{diff_svg, diff_rgba}` / `diff()` |

## Library choices

- Rendering: `resvg`/`usvg` 0.47 + `tiny-skia` 0.12, the same line as `obscura-render` in
  `aphrody-web`, so the ecosystem resolves one resvg version.
- XML: `roxmltree` 0.21 and `svgtypes` 0.16 (already pulled by usvg). DTDs are refused, which
  rules out entity-expansion attacks.
- Glyphs: `skrifa` 0.47 through its `OutlinePen` trait.
- Optimization: usvg's writer. svgo and scour stay out of product code; `@svgr/core` is not used.

## Inventory and migration map

Paths relative to the workspace root. "Converged" means the duplicate code was deleted and the
caller now uses `aphrody-svg`.

| # | Location | What | Status |
| --- | --- | --- | --- |
| 1 | `aphrody-ui/crates/aphrody-icons/src/svg.rs` (`PathPen`, `ScaledPen`) | glyph outline pen | Converged: uses `aphrody_svg::glyph::SvgPathPen` (fixed 2-decimal output); GSUB ligature lookup stays (Material Symbols specific). |
| 2 | `aphrody-ui/crates/aphrody-icons/tests/svg_parity.rs` | own resvg rasterize + compare | Converged: `aphrody_svg::diff::diff_svg`; the 8 pixel-parity tests pass. |
| 3 | `crates/ui/identity/src/pixel.rs` `rasteriser_svg` | resvg SVG → RGBA | Converged: delegates to `aphrody_svg::raster::render`; direct resvg/usvg/tiny-skia deps removed. |
| 4 | `crates/ui/bun/src/icons.rs`, `packages/interop/native/src/icons.ts` | Material Symbols over FFI | Kept (thin, icon-specific); new sibling FFI `bun_rs_svg` for the generic operations. |
| 5 | `aphrody-ui/packages/m3-icons/src/{plugin,codegen}.ts` | Bun plugin/codegen over #1 | Kept: thin wrappers of the `icons` module of `aphrody-bun`, no SVG logic. |
| 6 | `crates/ui/identity/src/pixel.rs` `vectoriser`, `assets.rs` `svg_depuis_png` | raster → SVG tracing | Kept in `aphrody-identity`: domain algorithm (mask tracing) that produces SVG, not SVG processing. |
| 7 | `crates/ui/sprite-sheet/src/lib.rs` `vers_svg` | `<symbol>` over PNG atlas regions | Kept: raster atlases; vector sprites use `aphrody_svg::sprite`. |
| 8 | `aphrody-ui/crates/aphrody-logo`, `aphrody-render/src/geometry.rs` (`parse_svg_path`) | logo `format!`, CPU path parser | Kept: generator of one asset; the CPU raster path parser feeds the no-resvg software renderer. |
| 9 | `aphrody-ui/drive/crates/images/src/svg.rs` (resvg 0.44) | Drive thumbnails | Converged: `SvgHandler` delegates to `aphrody_svg::raster::render(.., RenderOptions { system_fonts: true, .. })` (relative path dep, `drive/` is a separate Cargo workspace); the 0.44 resvg/usvg pin is removed from `drive/crates/images/Cargo.toml`. |
| 10 | `crates/web/obscura/crates/obscura-render/src/paint.rs` (`render_svg`, `svg_intrinsic`, `currentColor` injection, `<use>` extraction) | browser engine SVG pipeline | Not migrated: browser semantics (CSS viewport forced onto the root, `default_size`, Liberation Serif fallback, DOM serialization) and `aphrody-ui` already depends on `aphrody-web`, so a reverse dependency would couple the layers both ways. Same resvg line (0.47) now. |
| 11 | `aphrody-ai/py/aphrody/aphrody/icons.py` (`svg_to_png`, `png_to_ico`, `make_windows_ico`) | Python resvg-py + Pillow ICO | Not migrated: Python package; target is a `aphrody icon` Rust path in `aphrody-ai` consuming `../crates/ui/svg` (`raster::render_ico(.., WINDOWS_ICO_SIZES)`). |
| 12 | `aphrody-os/plugins/aphrody/skills/toriyama-svg/scripts/{rendu,icones}.ts` | sharp render/compare, favicon ICO | Not migrated: plugin skill scripts are copied into plugin caches, where a relative `file:` dependency and a native `bun_rs` do not follow; they also composite WebP logos with sharp. `@aphrody/svg` (`renderIco`, `diff`) is the replacement once the skills can ship a prebuilt library. |
| 14 | `nie/Cargo.toml` (resvg/usvg 0.48, tiny-skia 0.12) | unused workspace pins | Removed; nie reaches SVG only through `aphrody-identity`/`aphrody-sprite-sheet`, which now route through `aphrody-svg`. |
| 15 | `rg` | JSX icon components, MIME maps | Nothing to converge (no SVG processing). |

No SVG sanitizer existed anywhere before `aphrody_svg::sanitize`, and no MCP tool handles SVG.
