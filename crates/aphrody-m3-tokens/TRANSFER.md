# Native token owner transfer

Material owns the native M3 token engine and its framework font descriptors.
The crate identity remains `aphrody-m3-tokens`; `libm3` consumes this crate.

The input sources are:

- `aphrody-labs/aphrody` at `6c325505c6b686744b0711373a37308de3570ed9`,
  `crates/ui/m3-tokens`.
- the former Bun fork at `176fa03201a78cd9f4ac6e839294d81ef4852435`,
  `packages/web/rust/integrations/crates/ui/m3-tokens/src/google_sans_code.rs`
  and `google_sans_flex.rs`.

These input paths had no working tree changes when copied.
[transfer-receipt.json](transfer-receipt.json) records every input and output
SHA-256, repository revision and transformation. Algorithms, token values,
fixtures and font bytes were retained. The existing Role declaration and its
`ALL` array moved unchanged from `scheme.rs` to the allocation-free `role.rs`;
`scheme::Role` re-exports the same type.

The package now declares its dependency versions directly and compiles its
local framework font modules. It no longer depends on a separate source
provider or another repository's Cargo workspace. The original MSRV is 1.97.

## Embedded font contracts

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| Google Sans Code variable TTF | 268264 | `74642762fae66d5883077794a763e1086394b8cb72f2623e456e06359dc5c64b` |
| Google Sans Code OFL | 4396 | `ff8f4fbc4f1a71c7d4c6481c48dc2b21c43f8dc15872536667fee45c15d20928` |
| Google Sans Flex variable TTF | 4153208 | `0b67daf86ec4af890308d540f853082f6f77d98029cecbbd0134c6aafa0de39c` |
| Google Sans Flex OFL | 4303 | `76efb90a3bf8d7d91a3498d15fb409ee59ff43b0bf614b4afa0a947b6d7c75d3` |

The native Code descriptor targets the upstream v7.001 MONO/wght font.
`packages/m3-fonts/fonts.lock.json` instead pins a wght-only Code source with
SHA-256 `c9649573afcd966f61096b1e9c3c3115e7b54315ca2adf9839c6f8b17d5f8e1f`.
Its Flex source also differs: 4153392 bytes with SHA-256
`c31a482fbecbf2e07e6890134d20078723aadf732c9b9c6c9a44f86f8265b6fe`.
Their compatibility requires an explicit font and API qualification before a
shared revision can replace the existing native contract.

Font embedding and the public `TTF_DATA` / `CODE_TTF_DATA` constants remain as
in the original package. The `embedded-fonts` compatibility flag remains
available; it previously did not gate those constants. Heavy font bytes are
not an additional token algorithm and retain their own source identities.

## Integration boundaries

This transfer does not establish a native GUI, WASM, cross-platform or complete
Material application qualification. Existing tests were moved without adding
or running tests. On 2026-10-13, Aphrody pinned this Material revision and its
selected Rust consumers passed locked native Windows Cargo checks. The duplicate
crate source remains on disk in Aphrody, excluded from Cargo workspace membership;
its recursive removal was rejected by the host tool policy. This receipt does
not claim the duplicate files have been deleted. Tests were not run.
