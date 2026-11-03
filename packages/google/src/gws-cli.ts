#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { executeGwsCommand, getDiscoveryDoc, startGwsMcpServer } from "./gws.ts";

const args = Bun.argv.slice(2);

function printHelp() {
  console.log(`
Google Workspace CLI (gws) — Bun OS Core Integration
Fork: https://github.com/aphrody-labs/googleworkspace-cli (upstream: googleworkspace/cli)

Usage:
  gws <service> <resource> <method> [key=value ...] [--format=json|table|raw]
  gws mcp                                        Start native MCP server for AI agents
  gws discovery <service>                        Inspect runtime Discovery document
  gws help                                       Show this help

Examples:
  gws drive files list pageSize=10
  gws docs documents get documentId=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
  gws sheets spreadsheets get spreadsheetId=1...
  gws gmail users.messages list userId=me
  gws discovery calendar
`);
}

async function main() {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    printHelp();
    return;
  }

  if (args[0] === "mcp") {
    await startGwsMcpServer();
    return;
  }

  if (args[0] === "discovery") {
    const service = args[1] ?? "drive";
    const doc = await getDiscoveryDoc(service);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  const [service, resource, method, ...rest] = args;
  if (!service || !resource || !method) {
    console.error("Error: Missing required arguments: <service> <resource> <method>");
    printHelp();
    process.exit(1);
  }

  const params: Record<string, string> = {};
  for (const item of rest) {
    if (item.includes("=")) {
      const [k, v] = item.split("=");
      params[k] = v;
    }
  }

  try {
    const result = await executeGwsCommand(service, resource, method, params);
    if (typeof result === "object") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result);
    }
  } catch (err: any) {
    console.error("gws execution error:", err.message);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
