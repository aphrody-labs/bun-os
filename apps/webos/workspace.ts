// SPDX-License-Identifier: Apache-2.0
import { cp, lstat, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

/** Assemble the existing App UI artifact; compilation remains owned by packages/app-ui. */
export async function stageWorkspace(
  dist: string,
  root: string,
  source = Bun.env.BUN_OS_APP_UI_DIST,
): Promise<void> {
  const directory = resolve(root, source ?? "build/app-ui");
  const index = Bun.file(join(directory, "index.html"));
  if (!(await index.exists()))
    throw new Error(
      `Missing App UI artifact ${directory}. Build packages/app-ui/build.ts --base /workspace/ --out ${directory} through the VPS factory first.`,
    );
  const html = await index.text();
  if (!/<base\s+href=["']\/workspace\/["']/.test(html))
    throw new Error(
      "App UI must be built with --base /workspace/ before desktop assembly.",
    );
  const scripts = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']\.\/([^"']+)["']/g),
  ].map((match) => match[1]!.split("?")[0]!);
  if (!scripts.length)
    throw new Error("App UI artifact has no executable entry script.");
  for (const path of [...scripts, "wasm/aphrody_webos_wasm_bg.wasm"]) {
    if (
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("App UI artifact references an invalid asset path.");
    if (!(await Bun.file(join(directory, path)).exists()))
      throw new Error(`Missing App UI asset ${path}`);
  }
  await mkdir(join(dist, "workspace"), { recursive: true });
  await cp(directory, join(dist, "workspace"), { recursive: true });
}

