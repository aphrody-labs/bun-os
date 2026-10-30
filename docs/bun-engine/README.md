# Bun Engine

A Rust-first, Bun-operated cross-OS game engine. Bevy ECS, wgpu rendering,
winit platform integration and every declared owner form one distribution. Bun owns
asset tooling, automation, packaging and compatibility orchestration.

Its universal porting pipeline classifies executables, bytecode, ROMs, archives,
VFS images and firmware, then selects native rebuild, translation, emulation,
compatibility or packaging. Targets are PE, ELF, WebAssembly/WASI and Android
APK through unified owners; see `docs/UNIVERSAL-PORTING.md`.

The reverse-engineering surface is documented in
[`docs/GHIDRA-PLUGIN-SUITE.md`](GHIDRA-PLUGIN-SUITE.md): the private
`aphrody-code/ghidra-suite-plugin` AI orchestrator drives Ghidra, the native Rust
decompiler and NTRGhidra through one Bun Win32-aware pipeline.

The root manifests are canonical: `Cargo.toml`, `package.json`, `CMakeLists.txt`
and `vcpkg.json`. `bun-engine` is the only CLI; `include/bun_engine.h` is the
only stable native FFI and `web/app` is the single web entry point. All Bun
product code lives in `packages/bun-engine`; all native owners, including the
open SDK and firmware sources, live directly under `crates/`.

The first vertical slice uses the pinned CachyOS suite: `linux-cachyos`, its
kernel patch set, `proton-cachyos` and `wine-cachyos`. Proton owns Steam Play,
DXVK and vkd3d-proton composition; the launcher probes Steam, Vulkan, kernel and
user namespaces and records per-game support. See `docs/CACHYOS-SUITE.md`.
Dedicated-server and SteamPipe provisioning use the pinned SteamCMD container
owner described in `docs/STEAM-PLATFORM.md`.

The engine and the emulators are qualified privately against the owner's own
BIOS, keys and game dumps. `bep import`, the verified content-addressed store,
the encrypted bucket and VPS copies and `bep test owned` are described in
[`OWNED-DUMPS.md`](OWNED-DUMPS.md).

The Windows desktop path pins the Aphrody fork of Try Omarchy under
`crates/omarchy-windows`. Its launcher consumes QEMU from MSYS2 directly through
`TRYOMARCHY_MSYS2_ROOT` and keeps WHPX, guest images and runtime supervision in
the same Bun Engine distribution.

The pacman pipeline pins both CachyOS owners: `crates/pkg-manage-util` builds
packages and `crates/repo-manage-util` manages and synchronizes repositories.

EA SPORTS FC 27 is currently recorded as experimental. The project qualifies
its Windows publisher services, DirectX 12 path, Steam session and multiplayer
startup end to end without disabling required game components.

Commands:

- 'bun run probe'
- 'bun run compile' emits the optimized single-file executable.
- 're magika setup' and 're magika identify <path>' provision and use Magika classification.
- 're replica skills' lists the Replica workflow; 're replica skill recon' prints one skill and 're replica pipeline' exposes its ordered artifact pipeline.
- 're ghidra-win probe' qualifies Ghidra, NTRGhidra, Java and the native Windows toolchain through 'bun:windows' (fork-only API, not available on upstream Bun); 're ghidra-win inspect <pe>' uses the native PE parser before analysis.
- 'bep install', 'bep add' and 'bep pm' expose Bun Engine Packages.
- 'bep firmware:index' crawls the complete public BIOS catalog and every detail page through bounded native Bun fetch/HTMLRewriter workers, without exposing or downloading payload archives.
- 'bun run qualify:fc27'
- 'bun run ./packages/bun-engine/src/cli.ts launch <appid>'
- 'bun run ./packages/bun-engine/src/cli.ts trace <appid>' enables Proton logging for reproduction.

Jev may select one of the read-only actions in 'packages/bun-engine/src/jev-agent.ts'. It cannot
expand that allowlist or authorize installation, publication, DRM bypass or
anti-cheat bypass.

### Local firmware proof of concept

Import a dump made from hardware you own into the protected store outside the repository:

```powershell
bun run bep firmware:import nintendo-ds C:\path\to\your\bios.bin
```

Set `BUN_ENGINE_FIRMWARE_STORE` to override the default per-user store. Imports are content-addressed by SHA-256 and accompanied by a JSON manifest; firmware payloads and fixtures are ignored by Git.

### Native capability probes

`bep system:probe [host]` exercises Bun DNS, TCP/TLS, Image, Video, Win32 or Linux kernel APIs and discovers WinGet. `bep media:probe <file>` reads real image/video metadata through `Bun.Image` or `Bun.Video`.

`bep ds:load [directory]` validates and loads owner-supplied DS ARM7/ARM9 BIOS, SPI firmware and GBA BIOS dumps. The default directory is `./bin`; payload bytes never enter the JSON output or Git.
