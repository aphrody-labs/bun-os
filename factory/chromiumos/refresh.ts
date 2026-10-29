#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// ChromiumOS snapshot only; same flags as factory/aosp/refresh.ts.
const r = Bun.spawnSync([process.execPath, `${import.meta.dir}/../aosp/refresh.ts`, "--only", "chromiumos", ...Bun.argv.slice(2)], {
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(r.exitCode ?? 1);
