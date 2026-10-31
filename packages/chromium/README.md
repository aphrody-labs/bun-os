# @aphrody/chromium

The Bun OS owner of the browser builtins of the aphrody-labs/bun fork, running on upstream Bun
canary. The `@aphrody/chromium` Bun OS plugin (`./bun-plugin`, preloaded by
`@aphrody/bun-os-plugins`) serves the original specifiers, so fork-era code keeps importing them.

| Fork specifier                             | Module                    | Native part                                                                                           |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bun:chromium`, `bun:chrome` (same module) | `src/modules/chromium.ts` | Linux pidfd process groups via `bun:ffi` (`src/modules/process.ts`)                                   |
| `bun:obscura`                              | `src/modules/obscura.ts`  | none (the shared Chromium engine; the Obscura CDP server itself is `vendor/obscura`)                  |
| `bun:adblock`                              | `src/modules/adblock.ts`  | `crates/aphrody-adblock` (Brave adblock-rust, MPL-2.0) via `crates/aphrody-chromium-ffi`              |
| `bun:privacy`                              | `src/modules/privacy.ts`  | `crates/aphrody-privacy` (Brave STAR, PPOPRF, Privacy Pass, OPAQUE) via `crates/aphrody-chromium-ffi` |
| `bun:fetch`                                | `src/modules/fetch.ts`    | none                                                                                                  |
| `bun chromium` (`bun-chromium` CLI)        | `src/cli.ts`              | none                                                                                                  |

```ts
import chromium from "bun:chromium"; // with the Bun OS preload
import { launch } from "@aphrody/chromium"; // without it

const browser = await launch({ headless: true });
try {
  console.log(await browser.connection.send("Browser.getVersion"));
} finally {
  await browser.close();
}
```

`bun:adblock` and `bun:privacy` load `libaphrody_chromium_ffi` from `APHRODY_CHROMIUM_FFI` or the
checkout's Cargo target directory. Build it on the VPS with
`cargo-serial build -p aphrody-chromium-ffi --release -j4`.

Launch options: executable, userDataDir, headless, webgpu, url, extensions, timeout and signal.
Executable discovery honours `BUN_CHROMIUM_PATH`. On Linux the browser runs in its own process
group, owned through a pidfd (Linux 6.9 `PIDFD_SIGNAL_PROCESS_GROUP`). On Windows, a kill-on-close
job object is used when the `bun:windows` plugin provides `Job`; otherwise the process is killed
directly.

Type declarations for the `bun:` specifiers are in `types/` (reference `@aphrody/chromium/types`).

## Provenance and licences

Migrated from aphrody-labs/bun at `7c57ac563e12c35be817697c4b5488b0fd64cc09`: `src/js/bun/{chromium,obscura,adblock,privacy,fetch}.ts`,
`src/js/internal/chrome-manifests.ts`, `packages/bun-types/{chromium,chrome,obscura,adblock,privacy}.d.ts`,
`packages/bun-chromium` (also published as aphrody-labs/bun-chromium), `src/adblock`, `src/privacy`
and the JSC bindings `src/runtime/adblock/mod.rs` and `src/runtime/privacy.rs`, rewritten for
`bun:ffi`. Bun's original source is MIT (`LICENSE`); `packages/bun-chromium` files are
Apache-2.0; adblock-rust and the Brave privacy sources keep their MPL-2.0 headers and the
`crates/aphrody-adblock/LICENSE` file.
