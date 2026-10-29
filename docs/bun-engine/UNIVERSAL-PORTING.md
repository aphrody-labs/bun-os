# Universal porting pipeline

Bun Engine treats porting as a typed pipeline, not as a file-extension rename:

1. **Inspect** bounded headers and manifests without executing the input.
2. **Model** CPU, ABI, operating-system APIs, graphics, assets, VFS and firmware needs.
3. **Select** one execution strategy: native rebuild, translation, emulation, compatibility layer or packaging.
4. **Lower** through the registered owner plugin.
5. **Package** as PE (`.exe`), ELF, WebAssembly/WASI or Android APK.
6. **Qualify** behavior against deterministic fixtures and target hardware.

The dependency-free kernel currently identifies PE, ELF, WebAssembly, Nintendo DS ROMs,
common archives, disk/VFS images and firmware containers. Identification never implies
that the payload can already be decoded, rebuilt or executed.

## Owners

- Bun owns orchestration, streams, globs, packaging, `bun:ffi`, JavaScript/TypeScript parsing and the LSP.
- Rust owns the portable engine kernel, binary model and emulator plugins.
- Visual Studio (MSVC), LLVM/Clang and platform SDKs own native code generation.
- JSC owns WebAssembly execution; registered plugins own WASI and container lowering.
- `bun:dotnet` owns managed hosting. JNI/Ghidra uses the unified out-of-process analysis owner.
- Bevy ECS, wgpu and winit are required and pinned to the Aphrody forks.
- Console emulators are unified GPL owners with isolated linkage boundaries.
- The [Ghidra AI plugin suite](GHIDRA-PLUGIN-SUITE.md) owns reverse engineering:
  private Codex orchestration over native PE inspection, Rust decompilation, full
  Ghidra analysis and NTR loading.

## Non-goals

- No DRM, signature, secure-boot or anti-cheat bypass.
- No redistribution of ROMs, keys, BIOS, firmware or proprietary game data.
- No claim that an arbitrary opaque binary can be converted faithfully without its runtime,
  an emulator/translator, or rebuildable source and assets.
