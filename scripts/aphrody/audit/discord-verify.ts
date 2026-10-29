// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../");
const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const catalog = rootPkg.workspaces?.catalog ?? {};

// 1. Verify that canonical Discord packages are defined in the root catalog
const requiredCatalog = ["discordx", "discord.js", "discord-api-types", "@discordjs/rest"];

for (const pkg of requiredCatalog) {
  if (!catalog[pkg]) {
    throw new Error(`Discord catalog contract violation: '${pkg}' missing in workspaces.catalog`);
  }
}
console.log(`✓ Discord catalog contract: all ${requiredCatalog.length} required packages are catalogued`);

function run(cwd: string, ...args: string[]): void {
  console.log(`\n${cwd}: bun ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, {
    windowsHide: true,
    cwd,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 2. Gate @aphrody/discord-kit (Unified Discord bot core framework)
const discordKit = resolve(root, "packages/discord/kit");
for (const gate of ["typecheck", "test", "build"]) {
  run(discordKit, "run", gate);
}

// 3. Gate native standalone compilation if requested with --compile
if (process.argv.includes("--compile")) {
  run(root, "run", "packages/engine/yolo/src/index.ts", "ops", "discord", "compile", "all", "--smoke");
}

console.log("\nAll Discord monorepo gates, and shared packages passed successfully.");
