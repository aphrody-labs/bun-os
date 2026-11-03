#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos dotnet`: the fork's `bun dotnet`, routed by ../commands (docs/bun-engine/FORK-MIGRATION.md).
import { binMain } from "../commands/index.ts";

await binMain(import.meta.path);
