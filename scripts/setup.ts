#!/usr/bin/env bun
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { inspectCargoWorkspace, loadConfig } from "../packages/bun-workspace/src/index.ts";
import { runProcess } from "../packages/bun-workspace/src/process.ts";
import { inspectSetupSources, materialWebPreparationPlan } from "./setup-submodules.ts";
import { inspectReVendors, setupReVendors } from "./setup-re-vendors.ts";

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--plan")) throw new Error("Usage: bun scripts/setup.ts [--plan]");
const sources = await inspectSetupSources(root);
const material = materialWebPreparationPlan(root);
if (args[0] === "--plan") {
  const reVendors = await inspectReVendors(root);
  console.log(JSON.stringify({ root, sources, material, reVendors, qualification: "source-preflight-only" }, null, 2));
  process.exit(0);
}
if (!sources.ready)
  throw new Error(
    `Setup preserves source owners at different or conflicted revisions:\n${sources.retained.join("\n")}`,
  );
const env = {
  ...Bun.env,
  CARGO_TARGET_DIR: resolve(root, "target"),
  CARGO_INSTALL_ROOT: resolve(root, "install"),
};

async function run(argv: string[], processEnv: Record<string, string | undefined> = env, cwd = root): Promise<void> {
  const result = await runProcess(argv, cwd, {
    timeoutMs: 1_800_000,
    maxOutputBytes: 128 * 1024 * 1024,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: processEnv,
  });
  if (result.code !== 0) process.exit(result.code);
}

await run(["git", "submodule", "update", "--init", "--depth", "1"], env);
await setupReVendors(root);
await mkdir(resolve(root, "build/packages"), { recursive: true });
for (const command of material.commands) await run(command.argv, env, command.cwd);
// The tarball is packed on this machine, so its integrity is a local artifact: record it before the frozen install.
const lockPath = resolve(root, "bun.lock");
const digest = new Bun.CryptoHasher("sha512").update(await Bun.file(material.archive).bytes()).digest("base64");
const lock = await Bun.file(lockPath).text();
await Bun.write(
  lockPath,
  lock.replace(
    /(\["@aphrody\/material-web@build\/packages\/material-web\.tgz", \{.*?\}, )"sha512-[^"]+"/,
    `$1"sha512-${digest}"`,
  ),
);
await run([process.execPath, "install", "--frozen-lockfile"]);
// A clean CI checkout has no legacy nested installs to retire; its nested node_modules are fresh workspace links.
if (!Bun.env.CI) await run([process.execPath, "scripts/node-modules.ts"]);
const cargo = await inspectCargoWorkspace(await loadConfig(root), {
  root,
  timeoutMs: 60_000,
  runtimePolicy: "development",
  cargoContract: "members",
});
console.log(`Cargo workspace: ${cargo.packageNames.length} packages in ${cargo.workspaceRoot}`);
