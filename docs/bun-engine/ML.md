# Machine learning

Magika is the unified file-type classifier for Bun Engine. Its source is pinned at `vendor/magika`; its Rust/PyO3 core and bundled model remain owned by that fork and build in its isolated Python environment (`vendor/magika/python/.venv`).

```powershell
re magika setup
re magika identify README.md
re magika identify usr/lib/mgba --limit 200
```

`re magika setup` builds the locked Magika Python project with `bun uv` (on Windows from a Visual Studio developer prompt, because maturin compiles the PyO3 core with Cargo). `re magika identify` loads that environment in a uv-managed Python subprocess (the fork-only in-process bridge is gone), calls the narrow JSON bridge asynchronously and lazily constructs the classifier; a folder is classified in one session and returns per-label counts (MCP tool `magika_identify`). The embedded CPython host library comes from `BUN_PYTHON_HOST_LIBRARY` when that file exists, otherwise from the newest `bun-python-host` build of this checkout; `BUN_PYTHON_LIBPYTHON` must point at the host's libpython. Host-specific paths are never committed.

For a standalone `bun-engine` executable, set `BUN_ENGINE_HOME` to the checkout or distribution root containing `vendor/magika`.
