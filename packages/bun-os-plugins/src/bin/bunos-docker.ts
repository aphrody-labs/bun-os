#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos docker`: the fork's `bun docker`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
