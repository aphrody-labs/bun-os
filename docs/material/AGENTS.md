# Material workspace

Material owns the M3 framework, shared UI, native token engine and libm3 adapters.
Read GOAL.md, PLAN.md, MEMORY.md and START-HERE.md before changes. Preserve
concurrent submodule work. Follow Bun and COSMIC upstream conventions.

`crates/m3-tokens` is the sole Rust color, typography, shape, motion, state and
adaptive-token owner. `crates/libm3` consumes it for application and COSMIC
integration. `crates/libm3-wasm` is the same implementation's scalar ABI.
Distribution tooling consumes this workspace; it does not keep another copy.
`crates/m3` owns shared control models, accessibility, forms, focus, keyboard
handling and composition. Keep renderer adapters separate from these models.

Web submodules use `update = none` so Cargo fetches only the Rust owner. Full
web/source consumers explicitly run `git submodule update --init --recursive
--checkout`. Cargo consumer roots must patch `aphrody-m3-tokens` to the same
Material Git URL and exact revision as their other Material dependencies.

Use native Windows on the owner workstation; never start WSL. Resolve checkout
paths from configuration or the selected workspace. Type checks, lint and format
must run through the Bun runtime's built-in commands:
`bun check`, `bun lint` and `bun fmt`, invoked directly (`bun n2b` was fork-only and no longer exists). Do not route
these gates through subprocess backends, `bunx`, standalone Oxc binaries,
`tsc`/`tsgo`, ESLint, Prettier, or external n2b. Package scripts and CI must
preserve this contract. Run heavy Cargo commands through the configured
serialized native owner with explicit time bounds. Do not run tests unless
requested.

Retain licenses and exact source pins. Keep provider authentication, cookies,
raw sessions and other protected data in their isolated stores. Stage only
owned files; commit and push authorized batches as aphrody-dev.
