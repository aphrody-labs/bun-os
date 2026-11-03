#!/usr/bin/env bun
// @bun
// 3Dviz Pro Max helpers for Bun (MIT): built by Bun OS packages/viz3d from aphrody-labs/3dviz-pro-max@d077e0e68915. Do not edit; see NOTICE.
import {
  run
} from "./chunk-gwmh9j0b.js";

// src/bin/hero-tier.ts
process.exitCode = await run(["hero-tier", ...Bun.argv.slice(2)]);
