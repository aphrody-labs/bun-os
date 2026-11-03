// SPDX-License-Identifier: MIT
// `bun:wasm` of the aphrody-labs/bun fork (src/js/bun/wasm.ts: default { build, optimize, plugin }) over this package.
import { build } from "./build.ts";
import { optimize } from "./optimize.ts";
import { wasmPlugin as plugin } from "./plugin.ts";

export { build, optimize, plugin };
export default { build, optimize, plugin };
