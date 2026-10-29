<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Python Documentation Index

This index categorizes all architectural guides, engineering standards, technical reports, and package documentation across the **Aphrody Python** workspace. Shared architecture and cross-monorepo specifications live in the Aphrody monorepo docs.

---

## 1. Architecture & Technical Foundations

- **[Agent-First Architecture](architecture/agent-first.md)**: Measured Bun command contract, stack maturation, recursive workflow and Jan scope.

- **[Technical Documentation & Quickstart](README.md)**: Workspace technical overview, five architecture pillars, quickstart Bun and uv commands, and package catalog.
- **[Engineering Best Practices](BEST_PRACTICES.md)**: Deep guidelines on zero-copy memory (Arrow/Polars), PyO3 0.29 `Ungil` / `py.detach()`, PEP 484/561 typing markers, C-ABI FFI, and packaging isolation.
- **[Curated 2026 Ecosystem Reference (Awesome Stack)](AWESOME.md)**: High-performance ecosystem directory covering Rayon, parking_lot, Astral uv, Astral ty, CPython 3.14t, Polars, Pydantic V2, PyO3, Bun 1.4+, OXC, and Tauri 3.
- **[Rust-Python Convergence Research Report](RAPPORT_RUST_PYTHON_RESEARCH.md)**: Analytical deep-dive into the 5 pillars of Python modern architecture with empirical benchmark comparisons.
- **[Gemma 4 Family Architecture & Aphrody Integration](gemma4.md)**: Specifications for DeepMind Gemma 4 models (E2B, E4B, 26B/A4B MoE, 31B), multimodal token accounting, and multi-runtime execution.

---


## 2. Aphrody SDK & Native Packaging

- **[Aphrody SDK Overview](sdk/README.md)**: Architecture, features, and public API guide for the Aphrody Python SDK.
- **[Native SDK Packaging Plan](sdk/native-build.md)**: PyO3 compilation matrix, ABI3 stability guarantees, and Maturin wheel recipes.
- **[SDK Validation Strategy](sdk/validation.md)**: Clean virtual environment isolation, test automation, and gating criteria.
- **[SDK Production Plan](sdk/PLAN.md)**: Milestones and execution phases for SDK production hardening.
- **[Workspace SDK Audit](sdk/workspace-audit.md)**: Dependency analysis, export checks, and package boundary verification.

---

## 3. Workspace Packages & Applications

- **[Infrastructure Python Tools](../tools/infra/README.md)**: Operational scripts, benchmarking utilities, and deployment tooling.
- **[Python Environment Profiles](../environments/README.md)**: Target virtual environment specifications and pinned lock profiles.

---

## 4. Migration & Workspace Evolution

- **[Workspace Layout Refactor Plan](../PLAN.md)**: High-level architectural roadmap for the monorepo workspace.
- **[Python Import Manifest](migration/python-import-manifest.json)**: Canonical tracking of migrated Python modules and imports.
- **[Short-Path Migration Map](migration/short-paths-2026-10-03.json)**: Normalized import path mappings as of 2026-10-03.
