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
| `@aphrody/winreg` | re-export of `registry` (compatibility) | none | yes |

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
- windows-rs: the repository release `74` (2026-09-03) is not published as a `windows` crate; the newest crate is
  `0.62.2`, which the layer pins (same as `bun-windows-winclean`).

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

| Layer | Local (Windows 11 28120, Bun 1.4.4-canary, rustc nightly 2026-10-27, dotnet 10.0.401) | CI |
| --- | --- | --- |
| win32, shell, services, registry | `bun test` in `packages/windows` | not wired |
| winrt addon | built with cargo and loaded by Bun, tests pass | not wired |
| winui host | built, bootstrapper initialised against runtime 2.6.4, headless window click round trip | not wired |
| winclean, bun-steam, bun-shell | `bun test` in each package | not wired |
