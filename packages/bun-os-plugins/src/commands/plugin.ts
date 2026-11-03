// SPDX-License-Identifier: MIT
// The fork's CLI commands as `bunos-<name>` bins, listed in the registry inventory (`bun-os-plugins list`).
import { defineBunOsPlugin } from "../define.ts";
import { FORK_COMMANDS } from "./index.ts";

export default defineBunOsPlugin({
  name: "@aphrody/bun-os-plugins/commands",
  bins: Object.fromEntries(
    Object.keys(FORK_COMMANDS).map(name => [`bunos-${name}`, new URL(`../bin/bunos-${name}.ts`, import.meta.url)]),
  ),
});
