// SPDX-License-Identifier: Apache-2.0
//! Regenerate dragon-ball.scheme.css: the Dragon Ball reader skin is the canonical M3 scheme of its seed, rendered by
//! the Rust engine (crates/aphrody-m3-tokens through crates/libm3-wasm) and scoped to the skin's selectors.
//!
//!   bun run generate          # rewrite the sheet
//!   bun run generate --check  # fail when the committed sheet is stale

import { materialWasm } from "@aphrody/m3-tokens/wasm";
import { join } from "node:path";

/** The skin's brand seed (Dragon Ball orange). */
const SEED = 0xffe78220;
const VARIANT = "tonal-spot";
const SELECTORS = ".m3-reader--dragon-ball.m3-reader,\n.m3-reader--dragon-ball .m3-reader";
const OUT = join(import.meta.dir, "..", "dragon-ball.scheme.css");

const engine = materialWasm();
const variant = engine.variantNames.indexOf(VARIANT);
if (variant < 0) throw new Error(`unknown M3 variant ${VARIANT}`);
const sheet = engine.applyDynamicColor(SEED, variant, 0, "dark");
if (!sheet.includes("\n:root {")) throw new Error("unexpected scheme sheet shape");
const css = sheet
  .replace("Regenerate with: m3 tokens", "Regenerate with: bun run --cwd packages/m3-reader generate")
  .replace("\n:root {", `\n${SELECTORS} {`);

if (process.argv.includes("--check")) {
  const current = await Bun.file(OUT)
    .text()
    .catch(() => "");
  if (current !== css) {
    console.error("dragon-ball.scheme.css is stale: run bun run --cwd packages/m3-reader generate");
    process.exit(1);
  }
  console.log("dragon-ball.scheme.css is up to date");
} else {
  await Bun.write(OUT, css);
  console.log(`wrote dragon-ball.scheme.css (${css.split("\n").length} lines)`);
}
