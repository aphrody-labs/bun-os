#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos parse`: the fork's `bun parse`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
