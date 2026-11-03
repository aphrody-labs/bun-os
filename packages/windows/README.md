# @aphrody/windows

One Windows layer for upstream Bun: Win32 through `bun:ffi`, registry, services, shell folders, WinRT (windows-rs N-API addon sources), the WinUI 3 .NET host sources and WinClean. Windows only; run with Bun.

```sh
bun add @aphrody/windows
```

## Fork modules: `bun:windows`, `bun:winrt`, `bun:winui`

`src/bun-plugin.ts` serves the aphrody-labs/bun fork builtins on upstream Bun (registered by `@aphrody/bun-os-plugins`):

- `bun:winrt` (`src/fork/winrt.ts`): the fork projection, metadata read from `System32\WinMetadata` by the ECMA-335
  reader `src/fork/winmd.ts`, activation through `RoGetActivationFactory`, vtable calls through `bun:ffi`, IAsync
  results as Promises. Completion handlers are free-threaded COM delegates (`src/fork/com-delegate.ts`: x86-64
  IUnknown stubs plus a `threadsafe` JSCallback), replacing the fork native `com.rs`.
- `bun:winui` (`src/fork/winui.ts`): WinUI 3 XAML in the Bun process over `bun:winrt`.
- `bun:windows` (`src/fork/windows.ts`): version, systemInfo, isElevated, registry, services (read-only), clipboard,
  known folders, processes, memory and the PE/Authenticode parsers, in the fork shapes, over this package.

License: Apache-2.0. Source: https://github.com/aphrody-labs/bun-os/tree/os/packages/windows
