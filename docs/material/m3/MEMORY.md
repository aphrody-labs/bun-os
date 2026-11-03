<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody M3 — dated evidence

2026-10-13: the reduced private OS-theme implementation was replaced by the
shared `aphrody-m3-os-themes` owner at `27b36bd`. M3's MCP and showcase now
resolve the same Windows, GNOME, COSMIC and Chromium generator source as the
Material desktop package. Its validated native-theme adapter now lives under
the shared M3 token owner and the Material package re-exports that adapter;
the Rust token crate remains the only color generator. OS themes use the M3
baseline seed by default and accept a product seed from the host. The framework
lockfile points at version 1.4.5 with only its token workspace dependency.
Workspace installation and type qualification remain blocked by unrelated
missing workspace submodules/catalog entries; no tests were run.

2026-10-04: finalization scope confirmed as Aphrody M3. Baseline
`8f4b3a5177a5919c590066bc338be3d2e2fefd79`; preexisting production source work
and changed submodules are preserved and excluded from this owned delivery.

The [finalization receipt](./reports/FRAMEWORK-FINALIZATION.md) records the
commands, outcomes and remaining dependencies. Workspace exports/assets/links
have no errors, all 27 default TypeScript checks pass, and root lint exits 0
with existing warnings. Scoped UI qualification passes 211 tests with one
conditional native parity skip. The installed native Bun library loads through
Yolo; no new engine build or installed host support is inferred.

The owned CLI passes 7 regressions (22 assertions), explicit TypeScript, strict
lint and formatting. The complete script suite passes 72 tests with a 20-second
per-test timeout. The parallel package rerun outside the sandbox still fails
12 outer tests across scaffold, Next migration, sheets and showcase fonts;
concurrent source changes are described in the receipt. The runtime suite
passes 121 tests with 4 platform skips. Whole-framework completion remains open.

The delivered CLI selects M3's local `check` before an enclosing `bun:check`
and uses M3's owned root test task. Plans and guides now reflect the manifests,
source owners and qualification boundaries. The benchmark, selected export
scope, HTTP parity, DOM timing and installed host items in the receipt remain
open in their owning batches.

[PLAN.md](PLAN.md) owns the queue. [GOAL.md](GOAL.md) owns scope. This file is
dated file memory, not provider-memory synchronization or proof of activation.
