# Wii OS integration into Bun OS

This is an integration inventory, not a release or game-compatibility receipt. Bun OS ships
one unified image and session; Wii functionality belongs to its games and emulation owners.

## Existing owners

| Capability                 | Bun OS                                            | Wii OS source at the workstation           | Integration concern                                                                                                                          |
| -------------------------- | ------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Wii and GameCube execution | `crates/aphrody-wii-runtime`                      | `crates/gecko-core`                        | Compare behavior and retain one runtime owner; do not replace the existing DOL path.                                                         |
| Disc formats               | `crates/aphrody-wii-image`                        | `crates/gecko-image`                       | The optional `rvz` feature and Zstd dependency are restored. Wii OS also has a chunked RVZ reader.                                           |
| Browser emulator           | `apps/iecode-web-wii-wasm`, `apps/iecode-web/wii` | `crates/gecko-web`                         | Bun OS exposes checked Wii DOL boot; Wii OS has a separate RVZ loading interface and audio/input behavior to evaluate.                       |
| Wii menu and services      | Not yet established as a Bun OS owner             | `crates/menu-*`, `apps/server`, `frontend` | Preserve the menu, catalog and public service contracts when integrating; do not equate a static reproduction with the original System Menu. |
| Dolphin                    | `vendor/dolphin` and native package integration   | `dolphin-ffi`                              | The Wii OS bridge links a native Dolphin library; no Dolphin WASM/WebGPU runtime is established by this bridge.                              |

The local Wii OS tree inspected at `C:/src/wii/wii-os` has no accessible Git metadata. Its
source state, generated files, local user data, licenses and provenance therefore need to be
inventoried before importing changes. Resolve this path from configuration during any tooling;
it is recorded here only as the observed source location.

## Verified boundaries

- On 2026-11-03, Bun OS built the Wii WASM adapter from commit `c632e86c8c` on the VPS.
  Its Chromium SwiftShader smoke test executed four frames of a synthetic DOL and created a
  canvas. This does not prove disc boot, Wii Menu, game compatibility or hardware GPU support.
- The same day, `https://3dland.tech/` returned a menu page, but the browser showed a gray
  screen and reported `ReferenceError: $ is not defined` in `assets/js/main.js`.
  `/shenron` redirected to the Budokai Tenkaichi 3 page; the documented
  `/gecko-web/index.html` returned 404. The game page displayed a banner; game execution was
  not tested. These observations are point-in-time, not deployment guarantees.
- The local Wii OS README makes broader claims than these tests establish. Its RVZ parser and
  apploader paths must be qualified with owned test inputs, bounded resource handling and
  explicit errors before exposing disc loading as production-ready.
- On 2026-11-03, `aphrody-wii-image` compiled with `--locked --features rvz` and its
  uncompressed/Zstd metadata fixture passed on the VPS. Wii OS's existing Gecko multitool
  read the supplied Budokai Tenkaichi 3 RVZ header and file table locally; this is not a
  Bun OS disc-boot test. Wii OS's CLI `boot` currently treats non-WAD inputs as DOL bytes,
  despite its RVZ help text.
- Dolphin is marked pending in `packages/bun-engine/web-emulation/emulators.ts` because its
  JIT and graphics backends target native hosts. The requested Dolphin WASM/WebGPU path needs
  an actual browser build, adapter and game qualification before it can be selected.

## Integration gates

1. Test the restored RVZ reader with real and malformed inputs before exposing it.
2. Compare and port the chunked reader and browser load lifecycle into the canonical owners,
   preserving cancellation, memory bounds, the DOL API and source attribution.
3. Compare the menu, server, input, audio, NAND and NetPlay contracts against Bun OS owners;
   integrate each capability once and retain compatible public routes and explicit data paths.
4. Qualify browser and native paths with reproducible homebrew fixtures, real GPU and software
   fallback, then separately test licensed user-supplied discs and persistence. A passing
   synthetic DOL smoke test must not be used as evidence of commercial game compatibility.
5. Verify deployment from a published revision, with asset integrity, licenses, API contracts,
   health checks and rollback. Keep production untouched until its actual state is reconciled.
