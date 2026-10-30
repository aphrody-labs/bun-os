# WebOS data code

The JavaScript desktop of aphrody.com is demolished. The site is rebuilt in Rust (ADR-003,
[`docs/webos/ARCHITECTURE.md`](../../docs/webos/ARCHITECTURE.md)): OS sessions streamed from containers, served by
`crates/aphrody-webos-server` with a Rust WebAssembly client.

What remains here until its Rust port lands:

- `inventory.ts`, `descriptions.ts`, `src/config.ts`, `src/inventory-kinds.ts`, `apps.json`: the Bun OS inventory and its
  coverage gate (`bun apps/webos/inventory.ts --check`).
- `store/`: the package store data code.
- `wasm-modules.ts`, `build-wasm.ts`: WebAssembly module staging.
- `contracts/`, `services/wayland.ts`: API type reference and the live Wayland gateway.
