#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0 OR MIT
// bun stage.ts <ui-dir>: bundles the theme bridge into <ui-dir>/aphrody-theme.js and links it from index.html.
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: stage.ts <ui-dir>");
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "../src/boot.ts")],
  outdir: dir,
  naming: "aphrody-theme.js",
  target: "browser",
  format: "esm",
  minify: true,
});
if (!result.success) throw new AggregateError(result.logs, "theme bridge build failed");
const index = Bun.file(join(dir, "index.html"));
if (await index.exists()) {
  const html = await index.text();
  if (!html.includes("aphrody-theme.js")) {
    await Bun.write(index, html.replace("</head>", '  <script type="module" src="aphrody-theme.js"></script>\n</head>'));
  }
}
console.log(`theme bridge staged in ${dir}`);
