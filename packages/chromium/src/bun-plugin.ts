// SPDX-License-Identifier: MIT
// Bun OS plugin: the fork's browser builtins as virtual modules over this package.
import { defineBunOsPlugin } from "@aphrody/bun-os-plugins/define";

export default defineBunOsPlugin({
  name: "@aphrody/chromium",
  replaces: ["bun:chromium", "bun:chrome", "bun:obscura", "bun:adblock", "bun:privacy", "bun:fetch", "bun chromium"],
  modules: {
    "bun:chromium": new URL("./modules/chromium.ts", import.meta.url),
    "bun:chrome": new URL("./modules/chromium.ts", import.meta.url),
    "bun:obscura": new URL("./modules/obscura.ts", import.meta.url),
    "bun:adblock": new URL("./modules/adblock.ts", import.meta.url),
    "bun:privacy": new URL("./modules/privacy.ts", import.meta.url),
    "bun:fetch": new URL("./modules/fetch.ts", import.meta.url),
  },
  bins: {
    "bun-chromium": new URL("./cli.ts", import.meta.url),
  },
});
