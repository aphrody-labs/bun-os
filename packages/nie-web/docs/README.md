# IEVR web client source transfer

This client and its UI-only packages were moved from `nie` at source revision
`5714a3344f9190b4af558c79cb44fe804c5c9a74`. The file-level SHA-256 ledger
is in `nie/docs/SOURCE-TRANSFER-MANIFEST.json`.

The client is currently staged outside the active UI Bun workspace. It still
imports Radix and legacy site UI components, and its game Wasm build refers to
the NIE Rust workspace. Move those imports to Aphrody M3/Base UI and bind the
game artifact through IECODE before enabling this app. The existing Aphrody
desktop host owns native UI; this browser client must not create another
Tauri application. Open work and acceptance are in `nie/PLAN.md`.
