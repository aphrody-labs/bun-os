# Material 3

Monorepo for Material Design 3 components, tokens, themes, icons, and tools.

Packages are grouped directly under `packages/*`. Integrations remain decoupled
from the component model. `m3-bun` provides Bun commands for developing,
testing, serving, and packaging M3 applications.

## Layout

```text
packages/*  M3 packages
scripts/    workspace checks
docs/       design documentation
crates/m3-tokens/  native color and design-token owner
crates/m3/        shared controls, accessibility, focus and layout
crates/libm3/     application layouts and COSMIC adapter
crates/libm3-wasm/ scalar WASM ABI over that owner
```

## Platform alignment

The shared contract follows the Material 3 theme model used by Android
Compose: color scheme, typography, and shapes. Web packages expose the same
semantic roles through CSS tokens and web components. See
[`platform-alignment.md`](platform-alignment.md).

Native color generation, typography, shapes, motion, state layers and adaptive
breakpoints belong to `aphrody-m3-tokens`. `libm3` consumes that crate; it has no
independent palette or HCT implementation. The `std` feature enables dynamic
seed colors, nine variants and contrast. The portable `no_std` facade accepts
computed colors from the host.

The same facade exposes the existing native control models, keyboard handling,
accessibility, forms, focus and Taffy composition through `aphrody-m3`.

The Bun WASM loader is exported by `@aphrody/libm3/wasm`. ABI 2 uses the native
role order and distinguishes collapsed and expanded navigation rails. COSMIC
controls use the host event loop and must be mounted under the custom Material
theme. See [the native integration contract](libm3.md).

## Development

Web packages are submodules. Their default automatic update is disabled so
Cargo consumers can acquire the Rust framework without fetching every web
repository. Initialize the complete web workspace explicitly:

```powershell
git submodule update --init --recursive --checkout
```

```powershell
bun install
bun run list
bun check
bun lint
bun fmt
```

These quality commands (`bun n2b` was fork-only and is gone) use Bun's built-in implementations
directly. Do not add subprocess-backed linters or formatters, `bunx`, standalone
Oxc tools, TypeScript compiler binaries, ESLint, Prettier, or an external n2b
backend to workspace scripts or CI.

Cargo application roots must patch the registry token dependency to the same
Material Git URL and exact revision used by `libm3` or `aphrody-m3`. Patches in
dependency workspaces do not apply to the application's dependency graph.
See [the native integration contract](libm3.md).
