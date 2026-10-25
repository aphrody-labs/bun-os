<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 reproduce: a screenshot or a crawl to an M3 theme

`crates/ui/m3-reproduce` derives a seed colour and dynamic scheme, fonts, shape and a coarse
component list from a capture or a page, and emits a minimal `@aphrody/m3` scaffold. Colours
come from the exact `material-color-utilities` 0.4.0 port in `crates/aphrody-m3-tokens`, so they
are bit-identical to the reference for the same pixels.

## Pieces

| Piece | Path |
| --- | --- |
| Quantize and score (`QuantizerCelebi`, `QuantizerMap`, `Score`, `sourceColorFromImage`) | `crates/aphrody-m3-tokens/src/{quantize*,score,image}.rs` (`image` feature: PNG/JPEG only) |
| Pipeline and CLI | `crates/ui/m3-reproduce` (`ReproductionPlan`, theme, crawl, fetch, scaffold) |
| FFI | `crates/ui/bun/src/reproduce.rs`: `bun_rs_m3_reproduce`, `bun_rs_m3_seed_from_image` |
| Bun | `packages/interop/native/src/reproduce.ts`: `m3Reproduce(opts)`, `m3SeedFromImage(bytes)` |
| Parity fixture | `packages/m3-theme/scripts/mcu-image-fixture.ts`, `crates/aphrody-m3-tokens/tests/mcu_image_parity.rs` |

The one deviation from upstream: `QuantizerWsmeans` seeds from an explicit `mulberry32` RNG
instead of `Math.random()`, matched in the fixture script, so output is deterministic.

## Features

| Feature | Default | Adds |
| --- | --- | --- |
| `image` | yes | `ReproductionPlan::from_image_bytes` (capture bytes to seed). |
| `crawl` | no | Regex extraction from fetched HTML: theme colours, font stacks, median radius, images, flat landmark list mapped to M3 components (`crawl.rs::LANDMARK_TO_M3`). No DOM, no cascade, no JS. |
| `network` | no | Fetches the URL before crawling. |
| `cli` | no | The `aphrody-m3-reproduce` binary. |

```sh
cargo run -p aphrody-m3-reproduce --features cli --bin aphrody-m3-reproduce -- --url https://example.com --out ./reproduced
cargo run -p aphrody-m3-reproduce --features cli --bin aphrody-m3-reproduce -- --image screenshot.png --json
```

`bun_rs_m3_reproduce(kind, input, len)`: `kind` 0 URL, 1 image bytes, 2 HTML; returns
`{"ok":true,"plan":...}` or `{"ok":false,"error":...}`, freed with `bun_rs_free_string`.

The scaffold (`m3.config.ts`, `tokens.css`, `plan.json`, `src/index.html`, `src/App.tsx`) is for
review, not a finished app.

## Limits

Client-rendered sites need `--image`; capture does not drive a browser; landmarks are a flat list
(a real tree needs an HTML parser such as `obscura-dom`); `scaffold::emit_scaffold` should
delegate to `m3 new`.

## Gates

```sh
cargo test -p aphrody-m3-tokens --features image --test mcu_image_parity
cargo test -p aphrody-m3-reproduce --all-features
cargo clippy -p aphrody-m3-reproduce --all-targets --all-features -- -D warnings
cargo test -p aphrody-bun --lib reproduce
```
