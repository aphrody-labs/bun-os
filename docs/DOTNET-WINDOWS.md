# .NET, winget and PowerShell on Windows 11 for Bun OS

`packages/bun-dotnet-windows` (`@aphrody/bun-dotnet-windows`) is the Bun OS owner of three Windows capabilities:

| Module       | What                                                                                      | Engine                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `bun:winget` | winget search / list / show / install / upgrade / uninstall / sources, structured objects | `bunos_windows.dll`, C# Native AOT over winget's own COM/WinRT API `Microsoft.Management.Deployment`                              |
| `bun:pwsh`   | PowerShell 7 pipelines in the Bun process, output objects and every stream as JSON        | `BunOs.Pwsh.dll` on `System.Management.Automation` of the `vendor/powershell` source build, hosted through `bun:dotnet` (hostfxr) |
| `bun:d3d12`  | DXGI adapters and Direct3D 12 feature tiers, WinRT system profile                         | `bunos_windows.dll` (CsWin32 + CsWinRT) and `bunos_win_cpp.dll` (DirectX-Headers + WIL + C++/WinRT)                               |

Bins: `bunos winget ...`, `bunos pwsh ...` (routed by `packages/bun-os-plugins/src/commands`), also compiled with
`bun build --compile --bytecode` to `bunos-winget.exe` and `bunos-pwsh.exe`. WinClean tools: `winget_sources`,
`winget_search`, `winget_list`, `winget_show`, `winget_install`, `winget_upgrade`, `winget_uninstall`
(`packages/bun-windows-winclean/src/dotnet_windows.rs`); PowerShell evaluation stays the kernel's `compat_pwsh_eval`
and WinClean's `power_shell`, which now prefers the installed source build.

```ts
import winget from "bun:winget";
import pwsh from "bun:pwsh";
import d3d12 from "bun:d3d12";

await winget.search("ripgrep", { source: "winget", limit: 5 }); // [{ id, name, version, installedVersion, source, updateAvailable }]
await winget.list({ upgradable: true });
await winget.upgrade("Git.Git", {
  onProgress: p => console.log(p.state, p.downloadProgress),
});

const r = await pwsh.evaluate(
  "Get-Process -Id $PID | Select-Object Name,Id,WS",
); // r.output[0].Name === "bun"
d3d12.adapters(); // C# Native AOT
d3d12.adapters({ via: "cpp" }); // C++
d3d12.systemInfo(); // Windows.System.Profile, EAS device info, power, Win32
```

## Forks (aphrody-labs, pinned, built from source)

| Path                     | Upstream                  | Pin                                | Licence | Built here                                                                                                                                                                                                                        |
| ------------------------ | ------------------------- | ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/winget-cli`      | microsoft/winget-cli      | v1.29.380                          | MIT     | `PackageManager.idl` -> `Microsoft.Management.Deployment.winmd` (midl), its CsWinRT projection (in `bunos_windows.dll`) and C++/WinRT projection, `winrtact.dll` (UndockedRegFreeWinRT + `WinGetServer` manual-activation client) |
| `vendor/powershell`      | PowerShell/PowerShell     | main `cf5765391` (7.7.0-preview.5) | MIT     | `Start-PSBuild` Release, `fxdependent-win-desktop` on .NET 11 (the SDK its `global.json` pins), then crossgen2 ReadyToRun of PowerShell's own assemblies                                                                          |
| `vendor/wil`             | microsoft/wil             | v1.0.260126.7                      | MIT     | header-only, used by `winrtact.dll` and `bunos_win_cpp.dll`                                                                                                                                                                       |
| `vendor/detours`         | microsoft/Detours         | main `1dbd4ea`                     | MIT     | static library linked into `winrtact.dll`                                                                                                                                                                                         |
| `vendor/directx-headers` | microsoft/DirectX-Headers | (existing pin)                     | MIT     | headers for `bunos_win_cpp.dll` (`d3dx12` `CD3DX12FeatureSupport`)                                                                                                                                                                |

The winget COM server itself (`WindowsPackageManagerServer.exe`, the C++ `AppInstallerCLI` solution) is not rebuilt:
it ships with App Installer, needs Visual Studio's full MSBuild C++/UWP workloads and a vcpkg manifest restore, and
Bun OS talks to the installed server through the API built above. Building `WindowsPackageManager.dll` from the fork
would give the in-process route (`BUNOS_WINGET_ACTIVATION=inproc`, `BUNOS_WINGET_INPROC_DLL`); that is the pending item.

## Picks for "all of Windows 11" from C# and C++ (November 2026)

| Project                        | Licence                 | State (2026-11-03)                        | Native AOT                                                         | Decision                                                                                                                                                                                    |
| ------------------------------ | ----------------------- | ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CsWin32 (microsoft/CsWin32)    | MIT                     | v0.3.367, 2026-10-22, active              | yes (`allowMarshaling: false`: blittable structs, raw COM vtables) | **Pick**: every Win32/COM/DirectX API by name in `native/NativeMethods.txt`, generated from win32metadata                                                                                   |
| CsWinRT (microsoft/CsWinRT)    | MIT                     | 2.3.1 (2026-07), 3.0 preview              | yes (2.x AOT source generators)                                    | **Pick**: the Windows SDK projection (`net10.0-windows10.0.26100.0`) and projections of any `.winmd` (`CsWinRTInputs`), here winget's                                                       |
| win32metadata                  | MIT + Windows SDK terms | v71 preview, active                       | n/a                                                                | consumed through CsWin32                                                                                                                                                                    |
| Windows App SDK / WinUI 3      | MIT                     | 2.6.5 (2026-11-03)                        | partial (WinUI 3 trimming works, XAML AOT still preview)           | **Kept where it is**: `packages/windows/native/winui-host` owns WinUI 3; not duplicated here                                                                                                |
| TerraFX.Interop.Windows        | MIT                     | 10.0.26100.6 (2025-12), last push 2026-07 | yes                                                                | Not picked: hand-shaped full Win32/D3D12 bindings overlap CsWin32, which is Microsoft-maintained and generates only what is used                                                            |
| Vanara                         | MIT                     | 5.0.8, 2026-10-24, active                 | no (classic marshalling, reflection)                               | Not picked: large wrapper sets not trim/AOT clean                                                                                                                                           |
| C++/WinRT                      | MIT                     | 3.0.260818.1                              | n/a (C++)                                                          | **Pick**: `cppwinrt.exe` from the Windows SDK generates the projection of the SDK and of the winget winmd into `target/bun-dotnet-windows/cppwinrt` (source in `vendor/microsoft/cppwinrt`) |
| WIL                            | MIT                     | v1.0.260126.7, active                     | n/a                                                                | **Pick**: COM smart pointers and error handling in C++                                                                                                                                      |
| DirectX-Headers                | MIT                     | v1.620.1, 2026-10-28                      | n/a                                                                | **Pick**: newest D3D12 headers and `d3dx12` helpers, independent of the installed SDK                                                                                                       |
| DirectXTK12                    | MIT                     | may2026                                   | n/a                                                                | Not linked: rendering helpers (sprites, models) belong to a renderer member, not to the system ABI; available in `vendor/microsoft/DirectXTK12`                                             |
| D3D12MemoryAllocator (GPUOpen) | MIT                     | v3.2.1, 2026-10-26                        | n/a                                                                | Next pick for a renderer member, same reason                                                                                                                                                |
| Detours                        | MIT                     | main, active                              | n/a                                                                | **Pick**: required by winget's UndockedRegFreeWinRT                                                                                                                                         |
| ComputeSharp, Silk.NET         | MIT                     | active                                    | partial                                                            | Not picked: GPU compute / multi-API layers above the system ABI                                                                                                                             |
| windows-rs                     | Apache-2.0 / MIT        | 0.62 (crates)                             | n/a                                                                | **Stays canonical for Rust**; Rust binds the C ABI here only for features implemented in C# (winget)                                                                                        |

## Architecture

```
Bun (bun:ffi) ─┬─ bunos_windows.dll  C# Native AOT, .NET 10: bunos_call(method, json) / bunos_call_async(..., cb)
               │    ├─ CsWin32: Win32, COM, DXGI 1.6, D3D12 (raw vtables)
               │    ├─ CsWinRT: Windows.System.Profile, EAS, PowerManager, Windows.Management.Deployment
               │    └─ CsWinRT projection of Microsoft.Management.Deployment ──COM──> WindowsPackageManagerServer.exe
               │         winrtact.dll (loaded first): RoGetMetaDataFile/RoResolveNamespace detours find the winmd
               ├─ bunos_win_cpp.dll  C++20 /MT /GL: DirectX-Headers + WIL + C++/WinRT: bunos_cpp_call(method, json)
               └─ bun:dotnet (hostfxr, .NET 11) ─> BunOs.Pwsh.dll [UnmanagedCallersOnly] Eval / EvalAsync
                    └─ System.Management.Automation from PSHOME (vendor/powershell build, pwsh.deps.json resolution)
Rust (libloading) ── bunos_windows.dll  (bun-windows-winclean winget_* tools)
C/C++ ── include/bunos_windows.h
```

- One C ABI (`include/bunos_windows.h`): NUL-terminated UTF-8 in, a JSON envelope `{"ok":true,"value":...}` or
  `{"ok":false,"error":{"code","message"}}` out, freed by the library that allocated it. New Windows APIs are added
  as methods of the dispatcher (`native/Dispatcher.cs`, `cpp/bunos_win_cpp.cpp`), not as new exports, so bun:ffi,
  Rust and C++ bindings never change.
- COM/WinRT work runs on MTA thread-pool threads inside the library; the caller's apartment (Bun's JS thread) is
  never initialised or blocked. `bunos_call_async` and `EvalAsync` complete through a thread-safe `JSCallback`, so the
  event loop keeps running during a winget install or a long pipeline.
- winget activation: out-of-process `CoCreateInstance` (non-elevated); elevated callers go through
  `WinGetServerManualActivation_CreateInstance` of `winrtact.dll` (the server refuses elevated COM clients);
  `BUNOS_WINGET_ACTIVATION=outofproc|manual|inproc` forces a route. Why `winrtact.dll`: cross-process calls use the
  WinRT universal marshaler, which must find `Microsoft.Management.Deployment.winmd`. Packaged callers find it in their
  package graph; an unpackaged `bun.exe` gets `APPMODEL_ERROR_NO_PACKAGE (0x80073D54)` on the first QueryInterface.
  `winrtact.dll` detours the metadata resolution to also search its own directory, where the winmd is installed.
  Collections are walked by index (`IVectorView` Size/GetAt): the proxies do not answer `IIterable<T>` for every type.
- PowerShell is not Native AOT: the engine compiles script blocks with `System.Linq.Expressions` and
  `Reflection.Emit`, loads binary modules and their dependencies at run time and binds cmdlets by reflection, all of
  which Native AOT removes. Measured: a Native AOT exe on Microsoft.PowerShell.SDK 7.6.9 (.NET 10) compiles and links
  (37 MB, 29 trim/AOT warnings: IL2104/IL3053 for System.Management.Automation, System.Linq.Expressions,
  Microsoft.CSharp, Newtonsoft.Json, ...), then `PowerShell.Create().AddScript("1+1").Invoke()` fails with
  `PSSnapInException: Cannot load PowerShell snap-in Microsoft.PowerShell.Diagnostics ... Could not find file
Microsoft.PowerShell.Commands.Diagnostics.dll`: the engine loads its built-in cmdlets from assembly files. It is therefore
  hosted on the JIT runtime through `bun:dotnet`: BunOs.Pwsh is loaded into the default AssemblyLoadContext, and
  PowerShell's assemblies (including RID-specific ones and native libraries) resolve from PSHOME through
  `pwsh.deps.json` (`AssemblyDependencyResolver`). Because the CLR is one per process, `bun:pwsh` needs it started on
  .NET 11; `bun:pwsh` starts it with its own runtimeconfig when it is the first .NET user of the process.
- The framework-dependent PowerShell layout is published IL-only by its build (`PowerShell.Common.props`,
  `AppDeployment=FxDependent`); `scripts/build.ts pwsh-r2r` crossgen2-compiles PowerShell's 15 own assemblies
  (SMA 7.8 MB IL -> 19.8 MB R2R). NuGet dependencies keep their Microsoft signatures untouched.

## Build (workstation; Native AOT and MSVC do not cross-compile from Linux)

Toolchain: .NET SDK 10.0.403 and 11.0.100-rc.3 user-local (`dotnet-install.ps1 -Channel 10.0` and
`-Channel 11.0 -Quality preview`, into `%LOCALAPPDATA%\Microsoft\dotnet`), Visual Studio 18 Build Tools (MSVC
14.51, environment from `bun packages/buncc/src/cli.ts env msvc`), Windows SDK 10.0.26100 / 10.0.28000, CMake +
Ninja (Visual Studio's; depot_tools' `ninja` wrapper is skipped).

```sh
bun packages/bun-dotnet-windows/scripts/build.ts            # winmd, native, pwsh-host (+ pwsh, pwsh-r2r), cpp, bins
bun packages/bun-dotnet-windows/scripts/build.ts native --tfm net11.0   # the AOT library on .NET 11 (native-net11.0/)
bun test packages/bun-dotnet-windows
bun packages/bun-dotnet-windows/scripts/bench.ts             # numbers below; target/bun-dotnet-windows/bench.json
```

Exact commands the steps run (outputs under `target/bun-dotnet-windows/`):

| Step      | Command                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| winmd     | `midl.exe /nologo /winrt /W1 /nomidl /h nul /metadata_dir <UnionMetadata> /reference <UnionMetadata>\Windows.winmd /winmd winmd\Microsoft.Management.Deployment.winmd PackageManager.idl` (cwd `vendor/winget-cli/src/Microsoft.Management.Deployment`)                             |
| native    | `dotnet publish packages/bun-dotnet-windows/native/BunOs.Windows.Native.csproj -c Release -r win-x64 -p:BunOsTfm=net10.0 -p:BunOsWinmd=<winmd> -o native` (`PublishAot`, `IlcOptimizationPreference=Speed`, `IlcInstructionSet=x86-64-v3`, invariant globalization, no EventSource) |
| pwsh      | `Import-Module ./build.psm1; Start-PSBuild -Configuration Release -Runtime fxdependent-win-desktop -UseNuGetOrg -Output pwsh-fxdependent -ReleaseTag v7.7.0-preview.5` (cwd `vendor/powershell`, `DOTNET_ROOT` = user-local .NET)                                                   |
| pwsh-r2r  | `crossgen2.exe <asm> -o <out> --targetos windows --targetarch x64 -O -r <Microsoft.NETCore.App 11>\*.dll -r <WindowsDesktop.App 11>\*.dll -r pwsh-fxdependent\*.dll` per PowerShell assembly                                                                                        |
| pwsh-host | `dotnet publish packages/bun-dotnet-windows/pwsh/BunOs.Pwsh.csproj -c Release -p:BunOsPsHome=pwsh-fxdependent\ -o pwsh-host` (ReadyToRun, TieredPGO)                                                                                                                                |
| cpp       | `cppwinrt.exe -input <sdk> -input <winmd> -output cppwinrt -optimize`; `cmake -S packages/bun-dotnet-windows/cpp -B obj/cpp -G Ninja -DCMAKE_BUILD_TYPE=Release ...`; `cmake --build obj/cpp` (`/O2 /GL /LTCG /arch:AVX2 /guard:cf /CETCOMPAT`, static CRT)                         |
| bins      | `bun build --compile --bytecode --minify --target=bun-windows-x64 src/cli/bunos-winget.ts --outfile bin/bunos-winget.exe` (same for `bunos-pwsh`)                                                                                                                                   |

Release profile of the C++ half: whole-program optimisation (`/GL` + `/LTCG`), `/OPT:REF /OPT:ICF`, static CRT; Rust
members created here: none (the Rust side is the existing `bun-windows-winclean`, release profile of the workspace).

## Install (elevated, idempotent)

```sh
sudo.exe bun packages/bun-dotnet-windows/install/install.ts install    # Windows Sudo, inline
bun packages/bun-dotnet-windows/install/install.ts status
sudo.exe bun packages/bun-dotnet-windows/install/install.ts uninstall
```

From Git Bash, wrap it in a `.cmd` (sudo inline mode needs a console): `sudo.exe <checkout>\target\bun-dotnet-windows\install-elevated.cmd install`.
The install stages every file, Authenticode-signs the unsigned PE files with the machine-trusted Bun OS test
certificate (`factory/windows/signing/test-signing.ps1`, thumbprint `1E67DBDB0D46A61CF57D286A5562DD76675D4E87`),
copies into `%SystemRoot%\BunOS\dotnet-windows\` only what changed and writes
`%SystemRoot%\BunOS\manifests\bun-dotnet-windows.json` (path, sha256, size, source, signer of every file). It
refuses to overwrite a file it did not install; uninstall removes only files whose hash still matches the manifest.
No Windows file is touched, no reboot. Installed on the workstation 2026-11-03: 538 files, 25 signed here (the rest
already carry Microsoft signatures), licences of every fork under `licenses\`.

Lookup order of the libraries at run time (`src/paths.ts`): `BUNOS_DOTNET_WINDOWS_DIR`, the install, beside the
running exe, the build output.

## Numbers (workstation, Windows 11 28120, i7 Raptor Lake 24 threads, RTX 4070; 2026-11-03, other builds running)

See `target/bun-dotnet-windows/bench.json` for the raw run. Means unless noted.

| Measurement                                                                                                                                  | Result                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| bun:ffi -> C# Native AOT export (`bunos_ping`), .NET 10 / .NET 11 build                                                                      | 58 ns / 38-80 ns per call (2 M calls)             |
| bun:ffi -> C++ export (`bunos_cpp_ping`)                                                                                                     | 53 ns per call                                    |
| bun:ffi -> managed `[UnmanagedCallersOnly]` through hostfxr (JIT, .NET 11)                                                                   | 32 ns per call                                    |
| `bunos_call` JSON round trip (`winget.status`, MTA thread hop)                                                                               | 70 us                                             |
| `system.info` (CsWinRT + CsWin32)                                                                                                            | first 11.7 ms, then 0.2 ms median                 |
| `graphics.adapters`, D3D12 device per adapter (RTX 4070 + WARP), C# / C++                                                                    | 416 ms / 440 ms median                            |
| Cold start: `bun -e 0` vs `bun` + dlopen AOT + ping                                                                                          | 59.5 ms vs 78.2 ms (+19 ms)                       |
| pwsh in process (`bun:pwsh`), `Get-Date`: first call (runspace) / warm                                                                       | 1 255 ms / 0.8 ms median                          |
| pwsh in process, `Get-Process \| Select -First 5` warm                                                                                       | 27.7 ms median                                    |
| pwsh spawned per call (source-built `pwsh.exe`, ConvertTo-Json), `Get-Date`                                                                  | 1 516 ms median                                   |
| Process start: Store `pwsh` 7.6 `-c Get-Date` / installed `bunos-pwsh.exe -c Get-Date` (bun --compile --bytecode, CLR + runspace in process) | 946 ms (min 505) / 711 ms (min 614)               |
| winget search ripgrep (source winget), in process via COM: first / warm                                                                      | 2 458 ms / 467 ms median                          |
| Process: `winget.exe search` / installed `bunos-winget.exe search`                                                                           | 4 691 ms (min 437, max 23 564) / 518 ms (min 461) |
| `bunos-winget.exe status` (process start, AOT load, no COM work)                                                                             | 96.5 ms                                           |
| winget list --upgradable (composite of every source, msstore included), in process                                                           | 6.6 s median                                      |

Reading: a bun:ffi call into the Native AOT export costs tens of nanoseconds, the same order as a C++ export, and a
warm in-process pipeline returns in well under a millisecond where spawning `pwsh.exe` costs a full process start
plus engine initialisation every time. winget through the COM API avoids `winget.exe`'s process and table
formatting; the in-process search time is dominated by the catalog query itself.

## Pending

- In-process winget: build `WindowsPackageManager.dll` from `vendor/winget-cli` (MSBuild C++ solution, vcpkg) so
  winget runs without the out-of-process server.
- `bun:pwsh` and other `bun:dotnet` users share one CLR: if an owner starts it on .NET 10 first, `bun:pwsh` reports
  it; a single .NET 11 runtimeconfig for the process once .NET 11 is GA (2026-11).
- Machine-wide .NET 11 runtime for the installed `pshome\pwsh.exe` (today `DOTNET_ROOT` points at the user-local
  install; `bun:pwsh` and WinClean set it for their children).
- WinUI 3 / Windows App SDK stay in `packages/windows`; a CsWinRT 3.0 move once it leaves preview.
