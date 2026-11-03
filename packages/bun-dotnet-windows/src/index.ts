// SPDX-License-Identifier: MIT
/**
 * @aphrody/bun-dotnet-windows: Windows 11 for Bun OS from C# Native AOT, C++ and the in-process PowerShell engine.
 *   winget   Microsoft.Management.Deployment (COM/WinRT), bun:winget
 *   pwsh     System.Management.Automation hosted through bun:dotnet, bun:pwsh
 *   d3d12    DXGI / Direct3D 12 / WinRT system profile, bun:d3d12
 *   native   the raw C ABI (include/bunos_windows.h)
 */
export * as d3d12 from "./d3d12.ts";
export * as native from "./native.ts";
export * as pwsh from "./pwsh.ts";
export * as winget from "./winget.ts";
export { layout, type Layout } from "./paths.ts";
