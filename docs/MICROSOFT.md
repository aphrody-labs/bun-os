# Microsoft, Windows 11 and Fluent

Measured on the owner's Windows 11 Pro Insider Preview (build 10.0.28120), 2026-10-29, and in `.github/workflows/microsoft.yml`.
Only tested statements are made here. "Any Microsoft app" is not claimed: the matrix below says what was tested and what was not.

Scope reminder (owner, 2026-10-29): Fluent UI, Fluent Design and the Windows 11 theme are for the craft apps (Rust/egui) and the
Windows track. The Bun OS desktop shell and design system stay Material 3.

## Pinned versions (verified against nuget.org, npm and Wine on 2026-10-29)

| Component | Version | Source |
| --- | --- | --- |
| Windows App SDK (`Microsoft.WindowsAppSDK`) | 2.6.4 (newest stable) | https://www.nuget.org/packages/Microsoft.WindowsAppSDK |
| Windows SDK build tools | 10.0.28000.2957 | https://www.nuget.org/packages/Microsoft.Windows.SDK.BuildTools |
| Target framework | `net10.0-windows10.0.26100.0`, SDK 10.0.401 on this machine | https://learn.microsoft.com/windows/apps/winui/winui3/ |
| Fluent 2 tokens | `@fluentui/react-theme` 9.2.2 (microsoft/fluentui v9, `webLightTheme`, `webDarkTheme`) | https://www.npmjs.com/package/@fluentui/react-theme |
| Fluent web components | `@fluentui/web-components` 3.1.3 | https://www.npmjs.com/package/@fluentui/web-components |
| Wine used for the coverage matrix | `wine-11.20` | https://github.com/wine-mirror/wine/tree/wine-11.20 |

## Fluent (`packages/fluent`)

- Tokens: `bun packages/fluent/src/gen-tokens.ts` writes, from `@fluentui/react-theme`, 459 tokens per theme as
  `tokens/fluent2.json` (44 KB), `tokens/fluent2.toml` (38 KB, flat `[light]` / `[dark]` tables for the Rust craft apps),
  `tokens/fluent2.css` (CSS custom properties, names as in `@fluentui/web-components`) and `app/FluentTokens.xaml`
  (WinUI `ResourceDictionary`, 660 colour brushes `Fluent2.<token>`, 330 each for Light and Dark). Test: `packages/fluent/test/fluent.test.ts`.
- Native app: `packages/fluent/app` is a WinUI 3 app (unpackaged, self-contained, Windows App SDK 2.6.4) with `TitleBar`, Mica
  (`MicaBackdrop`), `NavigationView`, `InfoBar` and a `ContentDialog`; its button uses `Fluent2.colorBrandBackground` from the generated dictionary.
  Build: `dotnet build packages/fluent/app/FluentApp.csproj -c Release -p:Platform=x64` (do not pass `-o`: the XAML compiler then
  prefixes the PRI resource names with the output directory name and the window fails with "Cannot locate resource from ms-appx:///MainWindow.xaml").
  Output: 434 files, 235 MB (self-contained Windows App SDK and .NET 10 runtime).
- Proof on this machine: `bun test packages/fluent` launches the app from Bun, finds its window, captures it with `PrintWindow(PW_RENDERFULLCONTENT)`
  (committed at 480 px: `packages/fluent/fluent-app.png`, 20 340 bytes) and reads the control tree with UI Automation
  (`packages/fluent/uia-result.json`): `TitleBar`, `NavigationView`, two `ListItem`s, `StatusBar` (the InfoBar), `Button`, and the
  `ContentDialog` text after invoking the button through `InvokePattern`.
- Web variant: `packages/fluent/web` bundles `@fluentui/web-components` 3.1.3 (button, dialog, dialog-body, text, divider) with
  `Bun.build` (111 KB minified) and applies `webLightTheme` / `webDarkTheme` from `prefers-color-scheme`. Checked in the browser pane
  here (custom elements defined, dark brand `#115ea3` applied) and in headless Chrome in CI (`src/check-web.ts`). It is an option for
  the wasm shell only; the wasmos desktop shell remains Material 3.
- Not done: packaging this app as MSIX (`buncc package msix`) is not run (signing and Store belong to the signing owner); the app is
  launched from Bun with `Bun.spawn`, not through a .NET host library.

## Windows SDK and .NET

- `buncc dotnet publish -r win-x64 --aot` (`packages/buncc/src/dotnet-linux`) built the NativeAOT `hello.exe` here: 1 060 352 bytes,
  prints `{"rid":"win-x64","aot":true,...}` on .NET 10.0.12 (the ILCompiler package matching the installed SDK 10.0.401). The MSVC linker
  (VS 18 Build Tools 14.51) was found; ILCompiler needs `vswhere.exe` on PATH, which `buncc` now adds. `win-arm64` is attempted in CI only.
- Typed projections: this repository already carries the sources (`vendor/microsoft/CsWinRT`, `WindowsAppSDK`, `Windows-classic-samples`) and the
  windows-rs addon (`packages/windows`); no new projection was generated in this change.
- COM / IDispatch from Bun: `packages/microsoft/src/com.ts` creates a COM object by ProgID in a PowerShell child (`New-Object -ComObject`) and
  late-binds through IDispatch, results as JSON. Tested here with `Scripting.FileSystemObject` and `Shell.Application`.

### Windows 11 features on this machine (`bun packages/microsoft/src/cli.ts probe`)

| Feature | Check | Result here |
| --- | --- | --- |
| Windows App SDK runtime | Appx `Microsoft.WindowsAppRuntime.*` | present (1.1, 1.2, 1.4, 1.6, 1.7, 1.8, 2, CBS) |
| Windows ML | WinRT type `Windows.AI.MachineLearning.LearningModel` loads | yes (type availability only, no model run) |
| Toast notifications | `ToastNotificationManager` loads | yes (type availability only, no toast shown) |
| Share | `DataTransferManager` loads | yes (type availability only) |
| Jump Lists | `Windows.UI.StartScreen.JumpList` loads | yes (type availability only) |
| Dev Drive | `fsutil devdrv query` | enabled |
| Windows Terminal | Appx `Microsoft.WindowsTerminal*` | 1.24.12741.0 |
| Widgets board | Appx `MicrosoftWindows.Client.WebExperience` | not installed |
| Windows AI APIs | Appx `Microsoft.Windows.AI*` | not installed |

Not built, with reasons (also in `src/win11.ts`): App Actions (needs a packaged app declaring actions and Copilot+ hardware), Windows App SDK
AI such as Phi Silica (needs an NPU and the Windows AI package), a Widgets provider (packaged COM server, MSIX and signing), creating Jump Lists
from the app (needs a packaged identity).

## "Any Microsoft app": what is tested

| Route | Tested here | Result |
| --- | --- | --- |
| Office through COM (Excel, Word, PowerPoint, Outlook, Access) | ProgIDs looked up in the registry | none of the five is registered on this machine (Office not installed): automation code path exists (`withCom`) and is covered only through other COM servers |
| Packaged apps by AUMID | `Get-StartApps` | 185 Start entries, 41 packaged (`<PackageFamilyName>!<AppId>`, launch with `shell:AppsFolder\<AUMID>`) |
| Win32 import coverage against Wine 11.20 (static, from the PE import table) | see below | numbers below |
| Office.js, Microsoft Graph client, RDP RemoteApp for Office on Linux, winget and MSIX manifest parsing | not built in this change | Graph needs the user's device-code sign-in (left to the user, no credential stored); RemoteApp needs a Windows VM |

Wine import coverage (`bun packages/microsoft/src/cli.ts matrix <exe...>`, counts imported functions found in the 35 fetched Wine specs;
forwarders count as implemented; imports through `api-ms-win-*` and DLLs without a fetched spec are not counted, so `cmd.exe` shows few):

| Program | Imports counted | Implemented in Wine | Missing or stub | Examples |
| --- | ---: | ---: | ---: | --- |
| `notepad.exe` (Windows 11) | 140 | 138 (98.6 %) | 1 + 1 stub | `advapi32!DuplicateEncryptionInfoFile`, `propsys!PropVariantToStringVectorAlloc` (stub) |
| `explorer.exe` | 162 | 142 (87.7 %) | 20 | `ntdll!RtlPublishWnfStateData`, `ntdll!RtlFlushHeaps` |
| `cmd.exe` | 19 | 19 (100 %) | 0 | most imports are API sets and not counted |
| `FluentApp.exe` (this WinUI 3 apphost) | 66 | 66 (100 %) | 0 | the managed code and WinRT are not covered by this estimate |
| NativeAOT `hello.exe` | 105 | 105 (100 %) | 0 | |

This is an upper bound on API availability, not a statement that a program runs: behaviour, drivers, DRM and the WinRT surface of WinUI are not measured.

## Learn pages used

- WinUI 3 and Windows App SDK: https://learn.microsoft.com/windows/apps/winui/winui3/
- PE format: https://learn.microsoft.com/windows/win32/debug/pe-format
- NativeAOT cross-compilation rules: https://learn.microsoft.com/dotnet/core/deploying/native-aot/cross-compile
- Dev Drive: https://learn.microsoft.com/windows/dev-drive/
- Get-StartApps: https://learn.microsoft.com/powershell/module/startlayout/get-startapps
- Office automation model: https://learn.microsoft.com/office/vba/api/overview/

## Licences

The owner stated in chat that all licences are accepted. Used in this change: Windows App SDK, Microsoft.Windows.SDK.BuildTools and the .NET
ILCompiler through NuGet (nuget.org terms, packages restored by `dotnet build`), `@fluentui/*` (MIT). Nothing needed an interactive acceptance.

## MSIX, winget and manifest analysis (measured 2026-10-29)

- `bun packages/fluent/src/package-msix.ts` stages the app, generates the tile assets, runs `buncc package msix` (`makeappx` from
  Microsoft.Windows.SDK.BuildTools 10.0.26100.4654) and signs the package with a throw-away local certificate (`CN=BunOsLocalTest`, created in
  `CurrentUser\My`, exported to a temp PFX, both deleted afterwards; nothing committed, nothing added to a trust store).
  Result: `BunOs.Fluent-1.4.7.0.msix`, 96 533 186 bytes, "Package creation succeeded", signature present with subject `CN=BunOsLocalTest`,
  `Get-AuthenticodeSignature` status `UnknownError` (untrusted root, as expected). The package was **not installed**: that would need the test
  certificate in a trust store. Store submission and production signing are not done.
- `packages/microsoft/src/msix.ts` parses `AppxManifest.xml` (from an installed package or read back out of the `.msix` zip) and classifies it:
  `win32-packaged` (Wine import coverage applies), `winui-or-appsdk-dependent` and `uwp` (not covered by it). Test: the MSIX built above reads
  back as `win32-packaged`, x64, `FluentApp.exe`, `Windows.FullTrustApplication`. `parseWingetList` parses the `winget list` table by header columns (fixture test).
- UI Automation capture is now deterministic: `capture.ps1` polls with bounded deadlines (window, all controls in the UIA tree, a non-uniform rendered frame, the dialog text) instead of fixed sleeps; three consecutive local runs passed.

## Typed projection from Windows.winmd and an Office.js add-in (measured 2026-10-29)

- `bun packages/microsoft/src/winmd.ts <out.d.ts> <Namespace>...` reads `Windows.winmd` (Windows SDK 10.0.26100.0, `UnionMetadata`) with the .NET tool in
  `packages/microsoft/winmd` (`System.Reflection.Metadata`, no CsWinRT needed) and writes TypeScript declarations: enums with their real values, structs, interfaces
  and methods with parameter names, `IAsyncOperation<T>` as `Promise<T>`. `types/windows-notifications.d.ts` (212 types, `Windows.UI.Notifications` and
  `Windows.ApplicationModel.DataTransfer`) was generated this way. Test: `ToastDismissalReason` is `UserCanceled=0, ApplicationHidden=1, TimedOut=2` and
  `IToastNotificationManagerStatics` has `CreateToastNotifier`. These are declarations only; calling WinRT from Bun still goes through the existing windows-rs addon or a .NET host.
- `packages/microsoft/officejs` is a minimal task-pane add-in (unified manifest, `taskpane.html`, `taskpane.js`). It loads Office.js from the Microsoft CDN
  (`https://officeapis.public.onecdn.static.microsoft/1/office.js`, as in Learn) and, opened in a plain browser here, `Office.onReady` resolves with no host and the pane says
  "not running inside Office"; `Office.HostType` lists Word, Excel, PowerPoint, Outlook, OneNote. Inside Word or Excel it would insert text; that path is **not tested** (no Office installed here).
  The manifest was not validated with `office-addin-manifest`, and the add-in was not sideloaded.
