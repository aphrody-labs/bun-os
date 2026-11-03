#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos winmd`: the fork's `bun winmd`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
