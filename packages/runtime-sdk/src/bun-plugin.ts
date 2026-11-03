// SPDX-License-Identifier: Apache-2.0
// Bun OS plugin: the fork's `bun:python` builtin as a virtual module over this package (./python), on upstream Bun.
import { defineBunOsPlugin } from "@aphrody/bun-os-plugins/define";

export default defineBunOsPlugin({
  name: "@aphrody/runtime-sdk",
  replaces: ["bun:python"],
  modules: {
    "bun:python": new URL("./python.ts", import.meta.url),
  },
});
