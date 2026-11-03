// SPDX-License-Identifier: Apache-2.0
// Self-contained build with Bun.build: ESM, code splitting, linked source maps, @aphrody/* left
// external. Type declarations come from `tsc -p tsconfig.build.json`.
import { rmSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const entries = ["dynamic-color", "wasm", "native-theme", "breakpoints", "platform-contract", "expressive"];

rmSync(join(root, "dist"), { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: entries.map(name => join(root, "src", `${name}.ts`)),
  root: join(root, "src"),
  outdir: join(root, "dist"),
  format: "esm",
  target: "browser",
  splitting: true,
  sourcemap: "linked",
  external: ["@aphrody/*"],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs) console.log(`${output.kind.padEnd(11)} ${output.path.slice(root.length + 1)}`);
