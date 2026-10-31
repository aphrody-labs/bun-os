// SPDX-License-Identifier: MIT
// Bun OS plugin: the fork's bun:google as a virtual module over this package.
import { defineBunOsPlugin } from "@aphrody/bun-os-plugins/define";

export default defineBunOsPlugin({
  name: "@aphrody/google",
  replaces: ["bun:google", "bun google"],
  modules: {
    "bun:google": new URL("./bun-google.ts", import.meta.url),
  },
  bins: {
    "aphrody-google": new URL("./cli.ts", import.meta.url),
  },
});
