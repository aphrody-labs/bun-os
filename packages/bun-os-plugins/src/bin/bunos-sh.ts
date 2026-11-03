#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos sh`: the fork's `bunsh`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
