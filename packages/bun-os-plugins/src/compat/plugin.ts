// SPDX-License-Identifier: MIT
// Fork modules that are thin layers over upstream Bun APIs and have no other owner.
import { defineBunOsPlugin } from "../define.ts";

export default defineBunOsPlugin({
  name: "@aphrody/bun-os-plugins/compat",
  replaces: ["bun:vitest"],
  modules: {
    "bun:vitest": new URL("./vitest.ts", import.meta.url),
  },
});
