#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos agent-plugin`: the fork's `bun agent-plugin`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
