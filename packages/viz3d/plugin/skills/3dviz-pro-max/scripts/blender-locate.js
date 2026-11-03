#!/usr/bin/env bun
// @bun
// 3Dviz Pro Max helpers for Bun (MIT): built by Bun OS packages/viz3d from aphrody-labs/3dviz-pro-max@d077e0e68915. Do not edit; see NOTICE.
import {
  run
} from "./chunk-gwmh9j0b.js";

// src/bin/blender-locate.ts
process.exitCode = await run(["blender", ...Bun.argv.slice(2)]);
