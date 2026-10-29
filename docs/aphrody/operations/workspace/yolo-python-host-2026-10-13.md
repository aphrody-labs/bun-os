> **Legacy fork notice (2026-10-29).** This document predates the move to the unmodified upstream `bun` npm package (`1.4.4-canary.20261028.1`). The abandoned Bun fork, its fork-only commands, `bun:*` modules and `toolchains/bun` named here are history, not current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Yolo native Python host — 2026-10-13

The Python decision application remains in Aphrody. The native host remains
in the configured Bun fork, under `packages/bun-python-native` (not in repo); no source,
interpreter, environment or provider credential was copied into this repository.
See [Python ownership](../../plans/python-bun/PLAN.md).

## Qualification

The selected Windows Bun binary reports `1.4.4-canary.1`, revision
`2ae8fc65f`. The Bun checkout was at
`c98bee01e747d05151d9a49d9a210197e14dfda5`; its native Python package had no
working-tree changes. The existing Windows Cargo owner wrapper built
`bun-python-host` with `--locked --release`, using its canonical shared target
directory. No engine build or cache cleanup was necessary.

The resulting x64 DLL is 184,320 bytes, SHA-256
`c8c7e7888306c3cdfee875742738f71c73b0a8396a6649458eab2968e8ac05b5`.
CPython is the existing Aphrody 3.12.15 installation selected by
`BUN_PYTHON_LIBPYTHON`; no Python installation was replaced.

The package's two default native tests, explicit shared-interpreter/error test,
and explicit CLI subprocess conformance test passed. The latter checks Unicode
arguments, files, modules, stdin, exits, tracebacks, virtual environments and
reentry. The `cli_child` helper is invoked by that test rather than independently.
Strict all-target Clippy passed. Cargo used the serialized Windows factory;
sccache was disabled for this batch after its server failed to answer.

Real calls through the selected binary established that `bun:python` and
`buv:python` expose the same `Python` class, `Python.open()` loads the host,
Python and Bun have the same process identifier, evaluation returns both scalar
and structured JSON results, and explicit disposal completes successfully.

## Activation and limits

The user's previous `BUN_PYTHON_HOST_LIBRARY` pointed to an absent build output.
It now references the qualified DLL in the shared native Cargo output directory.
The path is resolved from the current host's `LOCALAPPDATA`, not a fixed checkout.
The existing interpreter and library selections remain in their isolated stores.
Fresh child-process probes loaded the repaired selection successfully. Existing
applications retain their environment until relaunched.

This qualifies a native development host and its configured user selection,
not a published host package, a bundled installer, a trained decision model,
production inference, or full Python/Rust/JavaScript object and buffer parity.
SDK-specific decision and TypeSafe compatibility tests are separate gates.
