// SPDX-License-Identifier: Apache-2.0
// Drive basics: run and probe the Spacedrive daemon (apps/spacedrive, binary `sd-cli`) built on the VPS.
//   bun scripts/aphrody/drive/sd-daemon.ts probe|status|start|foreground|stop
// The binary comes from SD_CLI or target/release/sd-cli; data lives in SD_DATA_DIR (default ~/.aphrody/drive).
// Nothing is built here: `cargo build --release -p sd-cli` runs through the serialized Cargo wrapper on the VPS.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const binary = Bun.env.SD_CLI ?? join(root, "target/release/sd-cli");
const dataDir = Bun.env.SD_DATA_DIR ?? join(homedir(), ".aphrody/drive");
const instance = Bun.env.SD_INSTANCE;

function args(...rest: string[]) {
  return ["--data-dir", dataDir, ...(instance ? ["--instance", instance] : []), ...rest];
}
function run(rest: string[], inherit = true) {
  if (!existsSync(binary)) throw new Error(`sd-cli is not built (${binary}); build it on the VPS with the serialized cargo wrapper`);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return Bun.spawnSync([binary, ...args(...rest)], { stdout: inherit ? "inherit" : "pipe", stderr: inherit ? "inherit" : "pipe" });
}

const [command = "probe"] = Bun.argv.slice(2);
switch (command) {
  case "probe": {
    // Qualification: the binary exists, reports a version and answers a status query against the data directory.
    const version = run(["--version"], false);
    if (version.exitCode) throw new Error("sd-cli --version failed");
    console.log(version.stdout.toString().trim());
    const status = run(["status"], false);
    console.log(status.exitCode === 0 ? "daemon: running" : "daemon: not running");
    break;
  }
  case "status":
    process.exit(run(["status"]).exitCode);
  case "start":
    process.exit(run(["start", "--no-default-sources"]).exitCode);
  case "foreground":
    process.exit(run(["start", "--foreground", "--no-default-sources"]).exitCode);
  case "stop":
    process.exit(run(["stop"]).exitCode);
  default:
    throw new Error("usage: sd-daemon.ts probe|status|start|foreground|stop");
}
