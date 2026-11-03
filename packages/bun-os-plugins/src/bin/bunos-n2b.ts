#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos n2b`: the fork's `bun n2b`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
