#!/usr/bin/env bun
// Generates every output of @aphrody/themes from tokens/*.tokens.json. `--check` fails when a committed output is stale.
import { join } from "node:path";
import {
  generatedRs,
  generatedTs,
  resolvedJson,
  tailwindCss,
  themesCss,
  windowEffects,
} from "./emit.ts";
import { build } from "./resolve.ts";

const root = join(import.meta.dir, "..");
export async function outputs(): Promise<Record<string, string>> {
  const m = await build();
  const components = await Bun.file(
    join(import.meta.dir, "components.css"),
  ).text();
  return {
    [join(root, "generated/themes.css")]: themesCss(m, components),
    [join(root, "generated/tailwind.css")]: tailwindCss(),
    [join(root, "generated/resolved.json")]: resolvedJson(m),
    [join(root, "generated/window-effects.json")]:
      JSON.stringify(windowEffects(m), null, 2) + "\n",
    [join(root, "src/generated.ts")]: generatedTs(m),
    [join(root, "../../crates/aphrody-themes/src/generated.rs")]:
      generatedRs(m),
  };
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [path, text] of Object.entries(await outputs())) {
    const cur = (await Bun.file(path).exists())
      ? await Bun.file(path).text()
      : "";
    if (cur === text) continue;
    if (check) {
      console.error(`stale: ${path}`);
      stale++;
    } else {
      await Bun.write(path, text);
      console.log(`wrote ${path} (${text.length} B)`);
    }
  }
  if (stale) process.exit(1);
}
