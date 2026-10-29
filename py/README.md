<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Python

A uv workspace for Python libraries, applications and tools, fused into the Aphrody
monorepo on 2026-10-05 (it was the separate `aphrody-py` repository). The Rust source is owned by the
monorepo: the SDK wheel builds `crates/ai/rag-python` in place. The longer-term direction is the
`vu` runtime (plan).

## Development

Requires uv 0.12.24, Bun 1.4+ and CPython 3.12 for the complete workspace.

```sh
# Unified commands (`yolo py`, the bounded supervisor of the Yolo runtime)
yolo py build       # Build the aphrody wheel (needs Cargo: serialized build host)
yolo py check       # Validate standalone locks and distribution wheels
yolo py test        # Execute fast test discovery across all packages
yolo py lint        # Code inspection via Ruff
yolo py fmt         # Deterministic code formatting
yolo py typecheck   # Static typing verification via Mypy

# Or using uv directly:
uv sync --all-packages --locked --extra rag --extra dedup
python tools/packaging/modernize_workspace.py check
uv run --package aphrody-cli aphrody-python version
```

`aphrody-python` and `aphrody-python-google` belong to the optional Python CLI.
`aphrody` and `aphrody-google` remain the Rust authorities, avoiding PATH
collisions. Legacy Python imports delegate to the separately installed CLI.
The library alone does not depend on Fire or the meeting application.
See [Best practices](docs/BEST_PRACTICES.md), [Ecosystem](docs/AWESOME.md)
and [Rust-Python research](docs/RAPPORT_RUST_PYTHON_RESEARCH.md).

## Layout

- `packages/aphrody/src/aphrody`: public SDK, DeepMind Gemma 4 native family, Multimodal Fine-Tuning, Jan bridge, and packaged Blender resources.
- `packages/cli/src/aphrody_cli`: Python command implementations, Gemma 4 CLI suite (tune, export, Jan manifest/install/serve), and CLI tests.
- `packages/aphrody-train/src/aphrody_train`: datasets, training and RAG APIs.
- `packages/embedding-fixtures`: reproducible native fixture generators.
- `packages/model-tools`: Koharu model exporters.
- `apps/meetings`: audio meeting application built on the SDK.
- `tools/`: operational, migration and packaging tools.
- `vendor/`: removed 2026-10-05; Bun is not vendored (fork the former Bun fork, its own repository).

The root owns workspace dependencies and tooling. Standalone SDK and training
locks are checked in temporary copies outside workspace discovery. Source
tests import installed editable packages without `pythonpath` injection;
distribution tests use clean installations outside the checkout.

## Validation and optional providers

The gates are repeatable (they build the native extension from `crates/ai/rag-python`,
so they run on the serialized build host):

```sh
python tools/packaging/modernize_workspace.py check
python tools/packaging/modernize_workspace.py providers
```

The last command qualifies the pinned private Antigravity fork and requires
Git authentication for `aphrody-labs/antigravity-sdk-python`. The core library
does not install this optional provider. No credentials belong in source files.
For CI provider jobs, configure a read-only Git credential through the runner's
existing credential helper; ordinary unit tests do not claim live provider parity.

See [current contracts](docs/sdk/workspace-audit.md),
[SDK validation](docs/sdk/validation.md), [native build](docs/sdk/native-build.md)
and the extraction plan. Historical migration evidence
stays under `docs/migration/`; protected datasets, model weights and secrets
stay in their existing private stores.

Linux is the supported platform; see [Linux contracts](docs/sdk/linux.md).
