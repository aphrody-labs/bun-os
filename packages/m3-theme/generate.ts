// SPDX-License-Identifier: Apache-2.0
//! Regenerate tokens.css, tailwind.css, spaceui.css and src/brand.ts.
//
// The sheets are rendered in Rust (crates/aphrody-m3-tokens/src/sheets.rs) and reached through
// @aphrody/bun's FFI, so this package holds no colour tables: the Rust crate is the single token
// source and the only colour engine.
//
//   bun run generate                      # M3 baseline seed #6750A4, tonal spot
//   M3_SEED=#1a73e8 M3_VARIANT=vibrant bun run generate

import { m3Css } from "@aphrody/bun";
import { join } from "node:path";
import { brandModule } from "./scripts/brand-module";

const seed = Bun.env.M3_SEED;
const variant = Bun.env.M3_VARIANT;
const contrast = Bun.env.M3_CONTRAST ? Number(Bun.env.M3_CONTRAST) : undefined;

const files = {
  "tokens.css": m3Css({ sheet: "tokens", seed, variant, contrast }),
  "tailwind.css": m3Css({ sheet: "tailwind" }),
  "spaceui.css": m3Css({ sheet: "spaceui" }),
  "src/brand.ts": brandModule(m3Css({ sheet: "brand" })),
};

await Promise.all(
  Object.entries(files).map(async ([name, text]) => {
    await Bun.write(join(import.meta.dir, name), text);
    console.log(`wrote ${name} (${text.split("\n").length} lines)`);
  }),
);
