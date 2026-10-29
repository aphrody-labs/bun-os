#!/usr/bin/env bun
// Bundles web/shell.ts (+ index.html, tokens CSS) into web/dist with upstream Bun.build. Dependencies come from the scratch install of src/deps.ts.
import { cpSync, mkdirSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { installFluent } from "./deps.ts";

const root = join(import.meta.dir, "..");
const deps = await installFluent();
const link = join(root, "web", "node_modules");
if (!existsSync(link)) symlinkSync(join(deps, "node_modules"), link, "junction");
try {
  const dist = join(root, "web", "dist");
  mkdirSync(dist, { recursive: true });
  const r = await Bun.build({
    entrypoints: [join(root, "web", "shell.ts")],
    outdir: dist,
    target: "browser",
    minify: true,
  });
  if (!r.success) throw new Error(r.logs.join("\n"));
  cpSync(join(root, "web", "index.html"), join(dist, "index.html"));
  cpSync(join(root, "tokens", "fluent2.css"), join(dist, "fluent2.css"));
  const js = await Bun.file(join(dist, "shell.js")).text();
  console.log(
    JSON.stringify({
      bytes: Buffer.byteLength(js),
      definesElements: js.includes("customElements") || js.includes(".define("),
    }),
  );
} finally {
  rmSync(link, { recursive: true, force: true });
}
