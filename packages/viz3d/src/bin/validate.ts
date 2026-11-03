#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Skill entry point: bun scripts/validate.js (bundled from @aphrody/viz3d by scripts/build-skill.ts).
import { run } from "../cli.ts";

process.exitCode = await run(["validate", ...Bun.argv.slice(2)]);
