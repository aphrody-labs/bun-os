// SPDX-License-Identifier: MIT
// Bun OS plugin: bun:winget, bun:pwsh and bun:d3d12 as virtual modules over this package (C# Native AOT, C++ and the
// bun:dotnet-hosted PowerShell). Registered by @aphrody/bun-os-plugins (root bunfig preload).
import { defineBunOsPlugin } from "@aphrody/bun-os-plugins/define";

export default defineBunOsPlugin({
  name: "@aphrody/bun-dotnet-windows",
  modules: {
    "bun:winget": new URL("./winget.ts", import.meta.url),
    "bun:pwsh": new URL("./pwsh.ts", import.meta.url),
    "bun:d3d12": new URL("./d3d12.ts", import.meta.url),
  },
  bins: {
    "bunos-winget": new URL("./cli/bunos-winget.ts", import.meta.url),
    "bunos-pwsh": new URL("./cli/bunos-pwsh.ts", import.meta.url),
  },
});
