# IECODE Web

`apps/iecode-web` is the sole active browser frontend. Its TypeScript UI lives here; the
Rust/WASM adapters are root Cargo workspace members in `apps/iecode-web-wasm` and
`apps/iecode-web-wii-wasm`. Reusable JavaScript/TypeScript libraries belong in `packages/`.

| Console         | Current browser capability                                                                                          | Rust owner                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Nintendo DS/DSi | Dust emulation with WebGPU presentation and WebGL fallback                                                          | `apps/iecode-web-wasm`, `crates/aphrody-dust-*`    |
| Wii             | Checked Wii DOL boot with Broadway interpreter and WebGPU presentation; keyboard Wiimote buttons, shake and pointer | `apps/iecode-web-wii-wasm`, `crates/aphrody-wii-*` |
| Switch          | Tegra block-linear texture primitives; browser execution pending                                                    | `crates/ruzu-*`                                    |
| Nintendo 3DS    | PICA commands and SHBIN parsing; browser execution pending                                                          | `crates/aphrody-ctr`                               |

The console switcher shows the current capability of each owner. It does not
offer a game launcher for a console whose CPU, devices and renderer are not yet
integrated. The remaining execution gates are in
[`docs/EMULATION.md`](../../docs/EMULATION.md).

## Build

Run `bun run --cwd apps/iecode-web build` from the repository root. Both browser adapters build
from the root Cargo lockfile through `scripts/iecode/build/build-emulator-web.ts`; initialize
the pinned `vendor/dust` submodule for its game database, and install
the `wasm32-unknown-unknown` Rust target and the wasm-bindgen CLI version listed
in Cargo.lock. DS retains compiler features and uses a bounded per-command
`RUSTC_BOOTSTRAP=1`. `bun run --cwd apps/iecode-web build:wii` builds only Wii;
`bun scripts/iecode/build/build-emulator-web.ts --dev` selects a debug Wii artifact.
Generated bindings and output stay ignored. Semantic checks use TypeScript 7
from the workspace catalog; webpack loaders explicitly use the official
`@typescript/typescript6` compiler API compatibility package.

Wii currently accepts homebrew DOLs and an optional caller-supplied DSP ROM.
It does not provide Wii disc loading or browser NAND persistence. Keyboard:
Z/X = A/B, 1/2, Enter = Plus, Minus, Home, arrows and Space = shake;
the pointer drives IR aim. Selecting another console unloads the Wii frame.

The explicit browser gate is `IECODE_BROWSER=/path/to/chromium bun
apps/iecode-web/tests/wii-browser-webgpu-smoke.ts` after building the Wii adapter. It checks malformed input rejection, three actual Broadway
frames and a WebGPU canvas using an original generated instruction fixture.
It does not establish game compatibility or rendering fidelity.
