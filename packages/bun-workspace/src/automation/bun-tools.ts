// SPDX-License-Identifier: Apache-2.0
import { runCommand } from "@aphrody/bun-os-plugins/commands";
import { runAphrodyBinary } from "./binaries.ts";

/** Run the single Bun OS MCP owner; arguments use aphrody-mcp's native CLI. */
export async function runMcp(args: string[]): Promise<number> {
  return runAphrodyBinary("aphrody-mcp", args);
}

/**
 * Run the TypeScript language server over stdio (`bunos lsp`). Upstream Bun has no `bun lsp`: that was the
 * aphrody-labs/bun fork's engine-linked bun_lsp, and its Bun OS route is the TypeScript native preview server.
 */
export async function runLsp(args: string[]): Promise<number> {
  return runCommand("lsp", args);
}
