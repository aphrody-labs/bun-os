// SPDX-License-Identifier: Apache-2.0
// One process: import m3-os-themes, generate every target once (cold), then 20 more times (warm).
// Prints JSON {importMs, firstMs, warmMs, files, bytes, digest}; the digest covers every generated path and byte.
import { join } from "node:path";

const src = join(import.meta.dir, "../../../../packages/m3-os-themes/src/index.ts");
const t0 = performance.now();
const { generate, TARGETS } = (await import(src)) as typeof import("../../../../packages/m3-os-themes/src/index.ts");
const t1 = performance.now();
const input = { name: "Aphrody", seed: "#6750a4", mode: "auto" } as const;
const files = generate(input, TARGETS);
const t2 = performance.now();
for (let i = 0; i < 20; i++) generate(input, TARGETS);
const t3 = performance.now();
let digest = 0n;
let bytes = 0;
for (const f of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
  digest = Bun.hash.wyhash(f.path, digest);
  digest = Bun.hash.wyhash(f.content, digest);
  bytes += f.content.length;
}
console.log(
  JSON.stringify({
    importMs: t1 - t0,
    firstMs: t2 - t1,
    warmMs: (t3 - t2) / 20,
    files: files.length,
    bytes,
    digest: digest.toString(16),
  }),
);
