// SPDX-License-Identifier: Apache-2.0
// Bundle the browser runner and the worker into dist/web, and copy the ORT wasm binaries next to them.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
export const dist = join(root, "dist", "web");
mkdirSync(join(dist, "ort"), { recursive: true });

const r = await Bun.build({
  entrypoints: [join(root, "web/main.ts"), join(root, "src/worker.ts")],
  outdir: dist,
  target: "browser",
  format: "esm",
  minify: true,
  naming: "[name].js",
});
if (!r.success) {
  for (const l of r.logs) console.error(l);
  process.exit(1);
}
cpSync(join(root, "web/index.html"), join(dist, "index.html"));

const ortDist = dirname(Bun.resolveSync("onnxruntime-web/package.json", root)) + "/dist";
if (!existsSync(ortDist)) throw new Error(`onnxruntime-web dist not found at ${ortDist}`);
for (const f of readdirSync(ortDist))
  if (/^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(f)) cpSync(join(ortDist, f), join(dist, "ort", f));
console.log(`built ${dist}`);
