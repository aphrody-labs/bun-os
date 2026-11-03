#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Skill entry point: bun scripts/design-context.js (bundled from @aphrody/viz3d by scripts/build-skill.ts).
import { run } from "../cli.ts";

process.exitCode = await run(["context", ...Bun.argv.slice(2)]);
