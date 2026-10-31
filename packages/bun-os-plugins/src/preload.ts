// SPDX-License-Identifier: MIT
// Root `bunfig.toml` preload: registers every Bun OS plugin before the entry module resolves.
// A fresh or sparse checkout runs Bun before `bun install` (CI setup, a new build host, the sync bootstrap): the plugin
// packages are not resolvable yet, so registration is skipped there instead of failing every command.
// BUN_OS_PLUGINS_STRICT=1 turns a registration failure back into an error.
try {
  const { registerAll } = await import("./index.ts");
  registerAll();
} catch (error) {
  if (process.env.BUN_OS_PLUGINS_STRICT === "1") throw error;
}
