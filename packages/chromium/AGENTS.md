# @aphrody/chromium agent contract

Follow the repository AGENTS.md and [README.md](README.md). This package owns the fork's
`bun:chromium`, `bun:chrome`, `bun:obscura`, `bun:adblock`, `bun:privacy` and `bun:fetch` on
upstream Bun; keep `bun:chrome` and `bun:chromium` the same module. Native code lives in
`crates/aphrody-chromium-ffi` (C ABI, `bun:ffi`), never in a runtime fork. Preserve protected
browser profiles and the MPL-2.0 notices of the absorbed Brave sources. Use `bun check`,
`bun lint` and `bun format`; build and qualify on the VPS.
