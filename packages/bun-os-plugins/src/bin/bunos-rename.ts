#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos rename`: the fork's `bun rename`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
