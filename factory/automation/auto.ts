#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bun OS automation (docs/AUTOMATION.md): one entry for every loop, run by the systemd user units on the VPS.
//   bun factory/automation/auto.ts install                 units, drop-ins, status snippet (idempotent)
//   bun factory/automation/auto.ts deliver [--force]       loop 1: deploy the last green gate
//   bun factory/automation/auto.ts health                  loop 2: probes, restarts, escalation
//   bun factory/automation/auto.ts guard                   loop 2: disk, OOM, runaway builds, logs, certs, compose
//   bun factory/automation/auto.ts deps <job> [args]       loop 3: forks | locks | bun | helium | android
//   bun factory/automation/auto.ts coordinator [--once]    loop 4: PRODUCT.md and tasks to agents
//   bun factory/automation/auto.ts nightly [--skip-build]  loop 5: build, boot, stream, screenshots, Gemini, publish
//   bun factory/automation/auto.ts image-build             the unified image build job (used by delivery)
//   bun factory/automation/auto.ts status | digest         render aphrody.com/status | post the daily digest
if (process.platform !== "linux") throw new Error("The automation loops run on the VPS");

const [command = "status", ...args] = Bun.argv.slice(2);
let ok: unknown = true;
switch (command) {
  case "install":
    ok = await (await import("./install.ts")).install();
    break;
  case "deliver":
    await (await import("./deliver.ts")).deliver(args.includes("--force"));
    break;
  case "health":
    await (await import("./health.ts")).health();
    break;
  case "guard":
    await (await import("./guard.ts")).guard();
    break;
  case "deps":
    ok = await (await import("./deps.ts")).deps(args[0] ?? "", args.slice(1));
    break;
  case "coordinator":
    await (await import("./coordinator.ts")).coordinator(args.includes("--once"));
    break;
  case "nightly":
    ok = (await (await import("./nightly.ts")).nightly(args.includes("--skip-build"))).green;
    break;
  case "image-build":
    ok = (await (await import("./nightly.ts")).imageBuild()).ok;
    break;
  case "status":
    await (await import("./status.ts")).renderStatus();
    break;
  case "digest":
    console.log(await (await import("./nightly.ts")).digest());
    break;
  default:
    throw new Error(`unknown command ${command}`);
}
process.exit(ok === false ? 1 : 0);
