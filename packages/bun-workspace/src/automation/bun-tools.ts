// SPDX-License-Identifier: Apache-2.0
import { runAphrodyBinary } from "./binaries.ts";

/** Run the single Bun OS MCP owner; arguments use aphrody-mcp's native CLI. */
export async function runMcp(args: string[]): Promise<number> {
  return runAphrodyBinary("aphrody-mcp", args);
}

/** Run upstream Bun's language server, preserving its stdio LSP transport. */
export async function runLsp(args: string[]): Promise<number> {
  const child = Bun.spawn([process.execPath, "lsp", ...args], {
    windowsHide: true,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}
