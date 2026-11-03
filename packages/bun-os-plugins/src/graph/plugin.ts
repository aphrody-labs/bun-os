// SPDX-License-Identifier: Apache-2.0
// Bun OS plugin: the fork's code-graph builtins (bun:graph, bun:graph-index, bun:graph-native, bun:graphx and the
// buv:/pyjs: aliases) as virtual modules; the Rust engine is crates/aphrody-code-graph (`aphrody-graph exec`).
import { defineBunOsPlugin } from "../define.ts";

const registry = new URL("./registry.ts", import.meta.url);
const graphx = new URL("./graphx.ts", import.meta.url);

export default defineBunOsPlugin({
  name: "@aphrody/bun-os-plugins/graph",
  replaces: ["bun:graph", "bun:graph-index", "bun:graph-native", "bun:graphx"],
  modules: {
    "bun:graph": registry,
    "buv:graph": registry,
    "pyjs:graph": registry,
    "bun:graph-index": new URL("./index-codebase.ts", import.meta.url),
    "bun:graph-native": new URL("./native.ts", import.meta.url),
    "bun:graphx": graphx,
    "buv:graphx": graphx,
    "pyjs:graphx": graphx,
  },
});
