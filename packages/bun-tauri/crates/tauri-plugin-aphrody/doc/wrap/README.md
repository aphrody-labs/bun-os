<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-tauri-wrap

Runtime plugin of [`@aphrody/web-to-tauri`](https://github.com/aphrody-labs/bun-os/blob/os/packages/web/rust/integrations/m3/packages/web-to-tauri): reads
`src-tauri/wrap.json` and creates the window with the navigation policy, downloads, loopback
server (bundle mode, with the backend proxy) and sidecar. Contract:
[`src/wrap/config.rs`](../../src/wrap/config.rs) in this crate.

The crate also hosts the debug bridge of Tauri 3 apps (`aphrody_tauri_wrap::debug::init()`, the
former `aphrody-tauri-debug` crate; guide: [`docs/guides/web/TAURI-DEBUG.md`](https://github.com/aphrody-labs/bun-os/blob/os/docs/aphrody-source/guides/web/TAURI-DEBUG.md)).

| Feature        | Default | Pulls in                                         | Without it                                           |
| -------------- | ------- | ------------------------------------------------ | ---------------------------------------------------- |
| `bundle`       | yes     | axum, http, reqwest, rustls, tokio               | `mode: bundle` is refused at startup                 |
| `debug-bridge` | no      | tauri-plugin-mcp-bridge (patched upstream), uuid | `debug::init()` is an empty plugin, no bridge linked |

`remote` and `sidecar` need no feature (the sidecar is std only). A remote or sidecar app, or one
that only wants the debug bridge, depends on the crate with `default-features = false`.
