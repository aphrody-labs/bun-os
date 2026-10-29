<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python workspace modernization

The measured workspace entry point is `yolo py` (supervisor: `packages/infra/workspace/src/python-workspace.ts`).
Packaging operations remain in `tools/packaging/modernize_workspace.py`, invoked
through locked uv pending qualification of their native Bun replacement.

- [x] Short package paths and one root uv workspace.
- [x] Uniform source layouts; separate CLI and meeting application distributions.
- [x] Compatible import facades and distinct Python/Rust executable names.
- [x] One authenticated, exactly pinned HTTPS Antigravity provider contract.
- [x] Real standalone lock checks and independently installed distribution gates.
- [x] Root lint, formatting, type checking and complete test discovery.
- [x] No global audio mocks, obsolete import paths or silent malformed corpus rows.
- [x] Complete first-party license metadata and typing markers.
- [x] Explicit runtime/model qualification boundaries and current documentation.
- [x] Unified Bun polyglot workspace scripts (`build`, `check`, `test`, `lint`, `fmt`, `typecheck`).
- [x] Astral Ty type checking rules and Ruff py312 configuration.
- [x] Complete PEP 484/561 PyO3 native stubs for all 12 SIMD vector operations.
- [x] Engineering best practices and Rust-Python convergence documentation.
- [x] Native Google DeepMind Gemma 4 family support (E2B, E4B, 26B/A4B MoE, 31B) across SDK, CLI, Web App, and MCP.


Run `apply`, then `check`; use `providers` for private provider contracts.
Validation results are recorded after successful execution, not inferred from
this plan. The architecture authority is the monorepo PLAN.md; the runtime plan is docs/plans/vu.

Linux is the supported platform; see [Linux contracts](docs/sdk/linux.md).

## Agent-First execution

Owner direction: 2026-10-03; [contract and maturation tree](docs/architecture/agent-first.md).

- [x] Factor root orchestration into an importable Bun module with JSON receipts and locked uv.
- [ ] Qualify and migrate packaging operations to the Bun capability owner.
- [x] Consume the pinned native SDK for bounded Linux supervision, cancellation and owned process-group cleanup.
- [x] Qualify the Python ctypes consumer of all four currently advertised Yolo C ABI 1.4 families on installed Linux x64, including an independently installed wheel; other targets and producer versions remain unqualified.
- [ ] Expose shared capability owners through authorized MCP/API adapters and native ABI where needed.
- [ ] Qualify a bounded recursive workflow with measured parallelism and explicit stopping criteria.
- [ ] Absorb the private Jan fork under `vendor/`: compare UI/backend/desktop/web/CLI/Python/Rust/TS against factual Aphrody owners; migrate missing capabilities without duplicates. The pinned source inventory and initial model-hub search migration do not prove full parity.
- [x] Vendored `vendor/gemma-tuner-multimodal` and `vendor/jan` with proper submodule tracking (vendor trees removed 2026-10-05; Bun is the only vendored source).
- [x] Gemma 4 Multimodal Fine-Tuning suite (Vision, Audio, Text, MoE Router LoRA/QLoRA) with assistant loss masking.
- [x] Gemma 4 Jan local runtime integration (Cortex/Nitro model manifests, index generation, GGUF metadata exporter, Jan proxy bridge).

Execution evidence and skipped gates belong in [MEMORY.md](MEMORY.md).
