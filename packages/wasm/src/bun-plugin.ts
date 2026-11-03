// SPDX-License-Identifier: MIT
// Bun OS plugin: the fork's `bun:wasm` builtin as a virtual module over @aphrody/wasm, on upstream Bun.
import { defineBunOsPlugin } from "@aphrody/bun-os-plugins/define";

export default defineBunOsPlugin({
  name: "@aphrody/wasm",
  replaces: ["bun:wasm", "bun wasm", "bun build --target=wasm"],
  modules: {
    "bun:wasm": new URL("./fork.ts", import.meta.url),
  },
  bins: {
    "aphrody-wasm": new URL("./cli.ts", import.meta.url),
  },
});
