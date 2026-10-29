<!-- SPDX-License-Identifier: Apache-2.0 -->
# Building the native SDK

`aphrody` ships its `aphrody.aphrody_rust` extension in every wheel. It provides
cosine similarity, top-k cosine similarity, reciprocal rank fusion and the float32 and
float64 vector kernels used by RAPTOR and UMAP. Wheels use PyO3's CPython 3.11+ stable ABI
(`abi3-py311`); builds require Python 3.11 or later and a Rust toolchain supporting
edition 2024.

## One owner for the Rust source

The extension is the workspace crate [`crates/aphrody-rust`](../../../crates/aphrody-rust)
(package `aphrody-rust`, library `aphrody_rust`), which depends on
[`crates/aphrody-rag-core`](../../../crates/aphrody-rag-core) for `fusion`, `vectors_f64` and
`vectors_f32`. Until 2026-10-05 a second crate with the same name lived in
`packages/aphrody/native`, fed by a pinned source archive (`source.json`,
`source.tar.gz`) and a verifying PEP 517 wrapper (`build_backend.py`). That projection
was byte-identical to the canonical modules apart from four packaging lines, so it was
removed: the Python package now builds the canonical crate in place.

`packages/aphrody/pyproject.toml` selects `maturin==1.14.1` as the build backend and points
`[tool.maturin].manifest-path` at the canonical crate with `locked = true`, so the root
`Cargo.lock` (PyO3 `0.29.x`, currently `0.29.3`, exact through the lock) and the workspace
dependency policy apply. The wheel carries the CycloneDX SBOM `aphrody-rust.cyclonedx.json`.
The previous exact `0.29.0` pin of the standalone recipe is superseded by the workspace
lock: the lock is the single place that fixes PyO3.

## Build

Heavy Cargo never runs in WSL. Build on the serialized build host (VPS tunnel, factory
locks); the monorepo checkout is the input:

```sh
uv build --wheel packages/aphrody --out-dir /tmp/aphrody-native-build
uv venv /tmp/aphrody-native-install
uv pip install --python /tmp/aphrody-native-install/bin/python --no-deps \
  /tmp/aphrody-native-build/aphrody-0.1.0-cp311-abi3-linux_x86_64.whl
/tmp/aphrody-native-install/bin/python -c \
  'from aphrody import aphrody_rust; assert aphrody_rust.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0'
```

Use `--wheel`: a source distribution of `aphrody` cannot be self-contained because the Rust
source lives outside the package directory, and a standalone sdist rebuild is no longer a
supported path. The `--no-deps` install above tests the extension independently; ordinary
SDK installs resolve the declared Python dependencies. Wheel content excludes tests and
build directories. Compiler and platform differences can change the resulting wheel bytes.

`yolo py build` and `tools/packaging/qualify_aphrody.py` run the same build. The native
crate itself is checked with the workspace gates (`cargo check`, `cargo test -p
aphrody-rust`) through `scripts/build/rust/vps-cargo.ts`.

## Numerical contract

RAPTOR arithmetic includes float64 normalization, matrix products and spherical
centers, plus direct Euclidean squared distances in float32/float64. UMAP's
float32 centroid means stay float32; implicit promotion can change assignments.
Python retains tree iteration, label ordering, first-minimum selection and
remapping policy. Native distance reduction uses the NumPy fast-axis ordering;
consumer tests compare the installed wheel against the prior NumPy arithmetic.

## Changing the extension

Edit `crates/aphrody-rust` or `crates/aphrody-rag-core` directly, keep `aphrody_rust.pyi`
(the PEP 561 stubs next to the package) in step with the exported functions, run the Rust
gates, then rebuild and verify the wheel with `tools/sdk/verify-wheel.py`. No generated
Rust source exists in this package any more.

The longer-term direction (a `vu` runtime that embeds CPython through PyO3 and ships uv and
ruff as libraries) is described in docs/plans/vu/PLAN.md.
