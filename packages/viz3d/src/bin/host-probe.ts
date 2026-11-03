#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Skill entry point: bun scripts/host-probe.js (bundled from @aphrody/viz3d by scripts/build-skill.ts).
import { run } from "../cli.ts";

process.exitCode = await run(["probe", ...Bun.argv.slice(2)]);
