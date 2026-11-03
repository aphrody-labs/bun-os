// SPDX-License-Identifier: Apache-2.0
// Bun OS plugin: the aphrody-labs/bun fork's Windows builtins (bun:windows, bun:winrt, bun:winui) as virtual modules
// over this package, on upstream Bun. Registered by @aphrody/bun-os-plugins (root bunfig preload).
import { defineBunOsPlugin } from "@aphrody/bun-os-plugins/define";

export default defineBunOsPlugin({
  name: "@aphrody/windows",
  replaces: ["bun:windows", "bun:winrt", "bun:winui"],
  modules: {
    "bun:windows": new URL("./fork/windows.ts", import.meta.url),
    "bun:winrt": new URL("./fork/winrt.ts", import.meta.url),
    "bun:winui": new URL("./fork/winui.ts", import.meta.url),
  },
});
