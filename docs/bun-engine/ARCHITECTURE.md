# Architecture

1. Kernel: `crates/bun-engine-core`; time, lifecycle, one C ABI and deterministic scheduling.
2. World: the pinned `crates/bevy` source in the unified workspace.
3. Render: pinned `crates/wgpu` with DX12, static DXC, WGSL, SPIR-V and GLSL.
4. Platform: pinned `crates/winit` windows, input, displays and event loop.
5. Editor: separate binary using the same public contracts.
6. Tooling: Bun asset graph, packaging, hot reload and compatibility services.
7. Binary ingestion: the dependency-free kernel identifies bounded PE, ELF, Wasm,
   Android packages and runtime formats (APK/AAB/APKS/APEX, DEX/OAT/ART),
   Nintendo DS, archive, virtual-filesystem and firmware headers. Identification
   reports architecture and endianness when the format defines them; decoding,
   mounting, execution and conversion delegate to their unified owners.
8. Reverse engineering: `bun:windows.pe` performs bounded Windows inspection,
   `crates/ghidra-decompiler` owns native decompilation, and the pinned Ghidra plus
   NTRGhidra sources own full analysis and Nintendo loaders. The private
   `aphrody-code/ghidra-suite-plugin` owns Codex/GUI/MCP/headless orchestration. See
   [GHIDRA-PLUGIN-SUITE.md](GHIDRA-PLUGIN-SUITE.md).
9. Linux gaming sources are catalogued and pinned under `vendor/`; they are
   not consolidated into the `crates/linux-cachyos`, `crates/kernel-patches`,
   `crates/proton-cachyos` or `crates/wine-cachyos` paths in this checkout.
   See [CACHYOS-SUITE.md](CACHYOS-SUITE.md) for the documented source owners
   and verify their current pins in `.gitmodules` and `sources.lock.json`.
10. The Windows Omarchy/QEMU integration is not present at the documented
    `crates/omarchy-windows` path; treat it as pending until its source and
    executable integration are inventoried here.

Physics, animation, audio, networking, scripting, streaming and authoring share
the same distribution contract and may load lazily through their owners.

The distribution declares a root Cargo workspace and a root Bun package
workspace, but Rust ownership is not fully consolidated: nested workspaces and
explicitly excluded source trees remain. The root manifest is therefore not
the sole Cargo workspace yet. CMake and vcpkg ownership is source-specific;
consult their manifests and the pinned source inventory before treating either
as a repository-wide owner. The Bun runtime implementation remains with its
canonical runtime repository (upstream oven-sh/bun, pinned npm `bun@1.4.4-canary.20261028.1`; the former `toolchains/bun` fork is removed); this
distribution does not own a `crates/bun-runtime` source tree. Linux gaming,
NVIDIA, CUDA and DirectX sources retain their own pinned source locations.
Package-management and repository-management integrations should be described
as present only where their paths and workspace membership are verified.

Console runtimes, CPU implementations and free native SDK source trees are
unified catalog entries described in [CONSOLE-PLUGINS.md](CONSOLE-PLUGINS.md).
Their implementations remain owner-routed rather than duplicated in the kernel.
