> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Python ownership transfer — 2026-10-09

The owner directed PyO3, uv, Ruff and vu into the Bun fork, retaining Python
application code in Aphrody. This batch transfers the CPython host and SDK
native bindings; the complete vu/toolchain and polyglot work continues in
[the active Python/Bun plan](../../plans/python-bun/PLAN.md).

## Delivered native owner

Bun commit `84a5f33140cef2a63088d8484e84c0a2e5aba785` is pushed to the existing
`aphrody-labs/bun` origin. Its independent `packages/bun-python-native` (not in repo)
workspace owns `bun-python-host` and `aphrody-rust`, with a committed lock.
It does not add a dependency to the Bun engine. Product algorithms remain in
`aphrody-rag-core`, pinned from Aphrody at
`c58e93d6dc1b4b2d420c3c929a40c67dd071d2f4`, without its unnecessary parser feature.
The Yolo PyO3 extension already belongs to the fork's runtime SDK at
`6181424bc2fca4349560832161c07ba85c33e8ef`.

The historical C symbols, status codes, allocation destructor and interpreter
attach/own behavior remain available through the Aphrody FFI's pinned dependency.
Python module identities remain `aphrody.aphrody_rust` and `yolo._yolo_native`.
The original native source files were removed only after fork builds and real
installed-wheel checks. No Python application, model, database, cache,
credential or installed environment was removed.

## Python build and consumer closure

The single Python-only build backend belongs to Bun at
`fcfc2a6dca114193a1d7120ad9cd7c2855a022b0`; both products depend on its immutable
Git package, with no copied backend implementation. It reads
`APHRODY_BUN_CHECKOUT` and the full revision
in each product manifest, archives committed fork inputs, and stages the native
workspace outside Aphrody. Its wheel uses the fork's Cargo.lock. Source
distributions contain Python, build metadata and legal records; no native
source or binary is copied into them. Editable builds point at the original
Python source. The native source contract cannot be overridden with a second
manifest argument.

Python qualification receipts now record the immutable fork revision and native
archive digest. Yolo's doctor, change-selected gates and explicit native Cargo
recipes reference the external owner. The local Cargo workspace no longer
contains PyO3 or either Python extension package. Concurrent website/root
manifest changes were preserved and kept outside this owned commit.

## Evidence and limits

- Windows fork workspace check and strict all-target Clippy passed.
- Real CPython 3.13 host lifecycle test passed: load/init/eval/call, exception,
  null argument/output behavior, matching string release and finalization.
- Both pinned-source development-profile wheels built successfully on Windows.
  The Aphrody abi3 wheel installed into an isolated 3.13 environment and passed
  native packed-vector/math/error checks and public SDK imports. The Yolo 3.13
  wheel installed there and passed all three existing native package tests.
- Python wheel/build contract suite: eight tests passed; scoped Ruff passed.
- Aphrody FFI no-default-feature check passed after retirement; strict all-target
  Clippy passed. This is compilation evidence, not a new installed FFI artifact.
- Scoped Yolo TypeScript passed. Bun suites: 21 passed, 10 explicitly skipped
  on Windows (Linux artifact/Unix fixture and Just recipe profiles).
- The standalone compiled-Yolo suite requires a qualified native tooling DLL
  absent in this context and was not qualified by this batch. No fake provider
  was substituted. The process-runner test now uses native Bun instead of `sh`.

No complete vu activation, native Bun `.py` dispatch, GPU, Cython/Jupyter,
mixed-file grammar, shared-object/zero-copy interop, binary size improvement or
startup/RSS improvement is claimed here. Those remain required work, with
explicit contracts and real target measurements.
