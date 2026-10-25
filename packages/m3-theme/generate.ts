// SPDX-License-Identifier: Apache-2.0
//! Regenerate tokens.css, tailwind.css and spaceui.css.
//
// The sheets are rendered in Rust (crates/aphrody-m3-tokens/src/sheets.rs) and reached through
// @aphrody/bun's FFI, so this package holds no colour tables: the Rust crate is the single token
// source, and its colours are bit-identical to @material/material-color-utilities
// (test/sheets.test.ts checks both).
//
//   bun run generate                      # M3 baseline seed #6750A4, tonal spot
//   M3_SEED=#1a73e8 M3_VARIANT=vibrant bun run generate

import { m3Css } from "@aphrody/bun";
import { join } from "node:path";

const seed = Bun.env.M3_SEED;
const variant = Bun.env.M3_VARIANT;
const contrast = Bun.env.M3_CONTRAST ? Number(Bun.env.M3_CONTRAST) : undefined;

const sheets = {
  "tokens.css": m3Css({ sheet: "tokens", seed, variant, contrast }),
  "tailwind.css": m3Css({ sheet: "tailwind" }),
  "spaceui.css": m3Css({ sheet: "spaceui" }),
};

await Promise.all(
  Object.entries(sheets).map(async ([name, css]) => {
    await Bun.write(join(import.meta.dir, name), css);
    console.log(`wrote ${name} (${css.split("\n").length} lines)`);
  }),
);
