<!-- SPDX-License-Identifier: Apache-2.0 -->
# Engineering Research Report: Rust-Python Convergence & Free-Threading (PEP 703)

This research report synthesizes the structural evolution, architectural paradigm shifts, and expected performance effects of the deep convergence between Rust systems programming and modern Python runtimes within the **Aphrody** and **rspyts** ecosystem.

---

## 1. Context: The Rustification of Python's Foundations

Over the 2024–2026 cycle, Python underwent the most significant architectural transformation in its history. This transformation was driven by the convergence of five complementary innovations:

1. **CPython Free-Threaded (PEP 703)**: Eliminating the Global Interpreter Lock (GIL) to enable true multicore parallelism on CPU-bound workloads.
2. **Astral uv**: Unifying the fragmented packaging ecosystem (pip, poetry, virtualenv, pyenv) into a native Rust binary.
3. **Astral ty**: Re-engineering static type checking using the Salsa incremental query engine for incremental feedback loops.
4. **PyO3 0.29 & Maturin**: Delivering memory-safe bindings with `Bound<'py, T>`, `py.detach()`, and compile-time `Ungil` thread safety.
5. **Apache Arrow & Polars**: Standardizing in-memory columnar data representations to unlock zero-copy inter-process communication and SIMD analytics.

---

## 2. In-Depth Analysis of the 5 Pillars

```text
                 ┌──────────────────────────────────────────────┐
                 │             Astral UV (Packaging)           │
                 │        PubGrub SAT Solver & CAS in Rust      │
                 └──────────────────────┬───────────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
 ┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
 │   CPython 3.14t  │          │   PyO3 & Maturin │          │    Astral TY     │
 │   Free-Threading │ ◄──────► │   Bound<'py, T>  │ ◄──────► │   Type Checker   │
 │   PEP 703 No-GIL │          │   C-API Native   │          │   Salsa Increm.  │
 └──────────────────┘          └──────────────────┘          └──────────────────┘
          │                             │                             │
          └─────────────────────────────┼─────────────────────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │      Aphrody Core Engine     │
                         │    SIMD & Rayon Work-Steal   │
                         └──────────────────────────────┘
```

### Pillar 1: CPython Free-Threading & mimalloc Allocator

Under PEP 703, CPython 3.13 and 3.14 provide official free-threaded builds (`python3.14t`):
- **Removal of the GIL**: Interpreter threads execute bytecode concurrently across all CPU cores without serializing on a global mutex.
- **Biased Reference Counting (BRC)**: Traditional reference counting causes catastrophic cache-line bouncing on multicore hardware. CPython solves this by assigning each object an owning thread:
  - The owning thread increments and decrements reference counts using non-atomic instructions.
  - Secondary threads use atomic instructions or record pending reference adjustments in thread-local queues.
- **mimalloc Integration**: CPython replaces `pymalloc` with Microsoft's `mimalloc`, providing thread-local allocation heaps that prevent lock contention during concurrent memory allocations.

### Pillar 2: Astral uv & Lifecycle Management

`uv` replaces the Python packaging stack with a unified, high-performance binary:
- **PubGrub SAT Solver**: Resolves dependency graphs in milliseconds using the PubGrub algorithm with conflict-driven clause learning.
- **Content-Addressable Storage (CAS)**: Package wheels are cached globally in content-addressed directories. Installations into workspace virtual environments use filesystem hardlinks or reflinks (copy-on-write on Btrfs, XFS, and APFS), so environment creation does not duplicate disk storage.
- **Deterministic Workspace Synchronization**: A single `uv.lock` coordinates all workspace members with reproducible cross-platform hashes.

### Pillar 3: Astral Ty & Incremental Typing

Modern codebases require real-time type verification in IDE loops:
- **Salsa Incremental Engine**: `ty` is built on the same incremental computation framework as `rust-analyzer`. Edits invalidate only the affected functions and downstream dependencies rather than re-parsing entire ASTs.
- **Native Pydantic V2 Support**: Direct understanding of Pydantic model schemas and generic constraints, eliminating runtime overhead.
- **Type Intersections & Narrowing**: Strict semantic analysis of type intersections, structural subtyping, and exhaustion checks.

### Pillar 4: PyO3 0.29 & Maturin

The bridge between CPython and Rust achieves complete memory and concurrency safety:
- **`Bound<'py, T>`**: Deprecates raw pointer access in favor of scoped smart pointers tied directly to the Python token lifetime, guaranteeing that Python objects cannot outlive their validity scope.
- **`py.detach()` & `Ungil`**: Replaces legacy `allow_threads()`. The compiler proves via the `Ungil` auto-trait that the worker closure does not capture non-thread-safe Python references before dropping the GIL.
- **Maturin Packaging**: Builds deterministic `abi3` extension wheels compatible with Python 3.11+ without recompilation.

### Pillar 5: Apache Arrow & Polars Zero-Copy Integration

Data-intensive applications require cross-language data interchange without serialization costs:
- **Arrow IPC Layout**: In-memory columnar representation standardized across Rust and Python.
- **Zero-Copy Transfers**: Rust algorithms populate Arrow RecordBatches that are ingested directly by Python Polars DataFrames (`pl.from_arrow()`) without memory duplication.
- **SIMD Vectorization**: Vector operations leverage native CPU vector units (AVX-512, ARM NEON) directly on contiguous arrays.

---

## 3. Performance Measurements

No benchmark in this repository backs the comparison figures that used to stand here
(lint time, `uv lock`, vector similarity, FFI call overhead, wheel packaging, binary size);
they were removed. The only recorded Rust-versus-Python kernel measurement is J22 in
`docs/plans/vu/PLAN.md` (`scripts/bench-kernels.py`, 20 000 x 384 float32,
best of 7): Rust similarities 5.3 ms against NumPy 7.9 ms, Rust normalize 47.5 ms against NumPy 7.1 ms.
