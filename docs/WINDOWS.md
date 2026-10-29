# Windows on Bun OS

One Windows layer on unmodified upstream Bun canary: `@aphrody/windows` (`packages/windows`). Upstream Bun has no
Windows-specific modules, so everything is `bun:ffi`, Node-API or a spawned process. Inventory and decisions:
`bun-upstream-research/windows-inventory.md`.

## Layers

| Module | Mechanism | Build | Works in `bun compile` |
| --- | --- | --- | --- |
| `win32` (version, isElevated, processes, processPath, memory, drives, volumes, uptime) | `bun:ffi` kernel32, ntdll, advapi32 | none | yes |
| `registry` (list, get, set, deleteValue, deleteKey) | `bun:ffi` advapi32 | none | yes |
| `services` (list, get; read-only) | `bun:ffi` Service Control Manager | none | yes |
| `shell` (`knownFolder`) | `bun:ffi` shell32 `SHGetKnownFolderPath` | none | yes |
| `winrt` (Uri, StorageFolder, device family) | Node-API addon on windows-rs 0.62.2 + napi 3.15 (`native/napi`) | `cargo` | yes (embed the `.node`) |
| `winui` (WinUI 3 window, XAML, get/set/click) | .NET 10 host on Windows App SDK 2.6.4 (`native/winui-host`), JSON lines | `dotnet publish` | host is a separate exe |
| `@aphrody/winclean` | tool catalog, its Windows host consumes the modules above | none | yes |

```ts
import { registry, services, shell, win32, winrt } from "@aphrody/windows";

win32.version();                     // { major: 10, build: 28120, isWindows11: true }
shell.knownFolder("LocalAppData");   // "C:\\Users\\...\\AppData\\Local"
services.get("RpcSs")?.state;        // "running"
registry.get("HKCU\\Software\\X", "Name");
winrt.parseUri("https://example.com:8443/a?b=1").host; // Windows.Foundation.Uri
```

Subpath imports (`@aphrody/windows/registry`, `/win32`, `/shell`, `/services`, `/winrt`, `/winui`, `/provider`) avoid
loading the other modules. Every `dlopen` is lazy, so importing on another platform is safe; calls throw
`WindowsError` with `ERR_WINDOWS_UNSUPPORTED`.

## Why these mechanisms

- Flat Win32 goes through `bun:ffi`: no build, usable in `bun compile`. HANDLEs are `u64`, not `ptr` (upstream
  `docs/runtime/ffi.mdx`).
- `bun:ffi` `cc` compiles with TinyCC and is experimental; it is not used for Windows because nothing guarantees the Windows SDK
  or WinRT headers.
- WinRT needs COM vtables, HSTRING and async operations, which windows-rs projects safely. Bun implements Node-API
  from scratch and loads `.node` files; the addon is plain `napi` + `napi-derive`, with no Node.js dependency.
  Add a call in `native/napi/src/lib.rs`, a typed wrapper in `src/winrt.ts`, a test.
- windows-rs versions (crates.io, 2026-10-29): the pre-generated `windows` crate is still `0.62.2` (2025-10-06) and is what
  the layer pins (same as `bun-windows-winclean`). The small crates (`windows-core`, `windows-link`, `windows-future`,
  `windows-bindgen`) moved to `0.100.0` (2026-09-03, MSRV 1.95) with the repository release `74`; the windows-rs README
  presents `windows-bindgen` (project-specific generated bindings) as the way forward and keeps the pre-generated `windows` /
  `windows-sys` crates as the convenience option for binaries. The two lines do not mix: `windows 0.62.2` resolves
  `windows-core 0.62.2`. Compile proof: `cargo build --release --locked` of `native/napi` succeeds on the pinned
  `rust-toolchain.toml` channel (`nightly-2026-09-15`, cargo 1.100, above the 1.95 MSRV). Migrate to generated bindings
  when a call needs an API the pre-generated crate lacks.
- Upstream warnings on `bun:ffi` (`docs/runtime/ffi.mdx`, `docs/runtime/c-compiler.mdx`, `docs/compiler/*.mdx`): `bun:ffi` is
  "experimental, with known bugs and limitations", "do not rely on it in production", and the most stable way to reach native
  code is a Node-API module. Hence the layer keeps `bun:ffi` to flat read-only Win32 calls with tests and puts WinRT in the
  N-API addon. `JSCallback` thread-safe mode is experimental and `close()` must be called to free the callback. In a
  `bun compile` executable on Linux 6.7 or later, `cc()` fails with `PR_SET_MDWE` (compile the C at build time and load it
  with `dlopen()`); this is Linux-only and does not touch the Windows modules, which never use `cc()`. Verified in upstream
  `docs/compiler/compatibility.mdx` (lines 191-192, oven-sh/bun@11c367163a4b): a compiled executable can have only 256
  `JSCallback`s open at a time (`RangeError: bun:ffi: a compiled executable can have 256 JSCallbacks open at a time`;
  remedy: `close()` the unused ones, the rest of `bun:ffi` keeps working), and `cc()` on Linux 6.7 or later throws
  `Cannot compile C code because this process can't create executable memory (PR_SET_MDWE)` (remedy: compile the C at
  build time and load it with `dlopen()`). The layer creates no `JSCallback`.

## Build the providers

```sh
cd packages/windows
bun run build:napi      # cargo build --release of native/napi, copies the cdylib to %TEMP%\aphrody-windows-napi\*.node
bun run build:winui     # dotnet publish of native/winui-host to %TEMP%\bun-winui-host
bun test
```

`APHRODY_WINDOWS_NAPI` (addon file), `APHRODY_WINDOWS_NAPI_DIR`, `WINUI_HOST_DIR` and `CARGO_TARGET_DIR` relocate the
outputs. Without the addon, `winrt` throws `ERR_WINDOWS_PROVIDER_MISSING` with the build command.

## WinUI 3 deployment

`@aphrody/windows/winui` drives a small .NET host (`native/winui-host`) that Bun spawns and talks to over JSON lines
(`open`, `get`, `set`, `click`, `close`). The host is an unpackaged, framework-dependent Windows App SDK app
(`WindowsPackageType=None`, `WindowsAppSDKSelfContained=false`, `Microsoft.WindowsAppSDK 2.6.4`,
`net10.0-windows10.0.19041.0`). An unpackaged app has no package identity, so it cannot declare the framework in a
manifest: it calls the Bootstrapper (`Microsoft.Windows.ApplicationModel.DynamicDependency.Bootstrap`) at startup, which
finds the installed `Microsoft.WindowsAppRuntime.<major>` framework package matching the requested major.minor and adds
it to the process package graph (Microsoft Learn, "Use the Windows App SDK runtime for apps packaged with external
location or unpackaged"). If no runtime is installed the host fails with `ERR_WINUI_RUNTIME_NOT_FOUND`: install the
Windows App Runtime, or build with `WindowsAppSDKSelfContained=true` to ship it beside the exe. The bootstrapper and
dynamic dependencies do not work in an elevated process, so do not run the host elevated. A packaged (MSIX) app
declares the framework in its manifest and gets package identity (notifications, background tasks, file
associations) at the cost of signing and install; choose unpackaged for developer tooling and Bun-spawned helpers,
packaged when identity APIs are needed (`buncc` has an `msix` provider).

`probe()` reports the installed runtime packages without building the host. The host needs an STA thread and
`Application.Start`; `WinUIHost` handles both. Known limit: `XamlControlsResources` cannot load without a compiled app
(`resources.pri`), so controls use default styles; a visible (non `headless`) window was not exercised.

### Runtime installer and manifest facts (Microsoft Learn, "Windows App SDK deployment guide for framework-dependent apps packaged with external location or unpackaged", "Use the Windows App SDK runtime ...", "Application manifests")

- **Silent install:** `WindowsAppRuntimeInstall.exe --quiet` runs with no user interaction and no text output; `--force` updates the MSIX packages and shuts down running Windows App SDK processes; `--h` lists the options. There is one installer per architecture (x64, x86, Arm64).
- **Return codes:** `0x0` success; `0x80073d06` one or more packages failed to install (the Appx code behind it is a package downgrade: a higher version is already installed); `0x80070005` system-wide install or provisioning was not possible because the process is not elevated or the user is not an admin. Without elevation the installer falls back to a per-user install.
- **Prerequisite:** the Visual C++ Redistributable is required for unpackaged and packaged-with-external-location apps (Learn links the "latest supported" download page). Experimental and preview runtimes also need sideloading (Developer mode).
- **Application manifest:** an unpackaged app should ship a side-by-side manifest with a `compatibility` / `application` / `maxversiontested Id="10.0.xxxxx.x"` element (value 10.0.17763.0 or later) so the Windows App SDK does not default to Windows 8 behavior and crash; `maxversiontested` is supported from Windows 10 1903. A larger value means older Windows versions will not run the app properly, so add several `maxversiontested` elements to cover more versions.
- **Framework package name:** Learn gives the framework package family name only as "release-dependent". On this machine the installed 2.x framework is `Microsoft.WindowsAppRuntime.2` with family name `Microsoft.WindowsAppRuntime.2_8wekyb3d8bbwe` (`Get-AppxPackage`, 2026-10-29), which is what `probe()` and `WINDOWS_APP_RUNTIME_FRAMEWORK` use; the 1.x line is `Microsoft.WindowsAppRuntime.1.<minor>`.
- **Source line:** the pinned `vendor/microsoft/microsoft-ui-xaml` is `winui3/release/2.5.1`, the newest stable ui-xaml tag (2.5.4-experimental is a prerelease), on the same 2.x line as Windows App SDK 2.6.4; the earlier 1.8.12 pin belonged to the 1.x line and was repinned.

## Registry safety

Tests use a temporary `HKCU\Software\aphrody-*-<pid>` key and delete it in `afterAll`. Services are read-only
(`list`, `get`); starting, stopping or installing services is deliberately not exposed by the layer.

## Migration state

Migrated callers: `@aphrody/winclean` (`windows-host.ts`), `@aphrody/bun-steam`, `@aphrody/m3-bun`,
`@aphrody/m3-fonts`, `infra/config/host/windows/terminal/bun-shell.ts`. Remaining copies (`git grep -l 'dlopen("kernel32'`
outside `packages/windows`): `scripts/aphrody/tools/infra/win32-{user,net}.ts`, `scripts/aphrody/tools/os/windex/win32.ts`,
`packages/bun-workspace/src/windows-job.ts`, `packages/google/src/credentials.ts`,
`packages/product/src/admin/lib/fleet/windows.ts`, `packages/bun-os-platform/src/i18n/index.ts`,
`scripts/aphrody/install/mesh-supervisor.ts`, `packages/bun-engine/src/owned/store.ts`, `docs/aphrody/win-window.ts`.

Backlog of fork `bun:windows` areas not yet in the layer: eventlog, clipboard, conpty, dll search path, job objects
(`windows-job.ts` is the seed), NTFS, storage, toast, wintrust, WSL, GPU; dynamic WinRT projection from `.winmd`
(`plugins/winmd`); in-process .NET through a NativeAOT library loaded with `bun:ffi` (`buncc` dotnet provider builds it).

## Qualification

| Layer | Local (Windows 11 28120, Bun 1.4.4-canary, Rust channel from `rust-toolchain.toml` (nightly-2026-09-15), dotnet 10.0.401) | CI |
| --- | --- | --- |
| win32, shell, services, registry | `bun test` in `packages/windows` | not wired |
| winrt addon | built with cargo and loaded by Bun, tests pass | not wired |
| winui host | built, bootstrapper initialised against runtime 2.6.4, headless window click round trip | not wired |
| winclean, bun-steam, bun-shell | `bun test` in each package | not wired |
