#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { CANONICAL_REGISTRY, CLIS, MCP_SERVERS, PLUGINS, SKILLS } from "./data.ts";

const args = Bun.argv.slice(2);

function printHelp() {
  console.log(`
Bun OS Unified Component Registry (aphrody-registry / bunos-registry)

Usage:
  bunos-registry [command] [options]

Commands:
  summary          Print counts and high-level architecture overview
  mcp              List all registered MCP servers
  skills           List all registered Agent Skills
  plugins          List all registered runtime & native plugins
  clis             List all registered command-line tools
  json             Output full registry as JSON
  help             Show this help message

Options:
  --json           Format output as JSON
`);
}

function main() {
  const cmd = args[0] || "summary";

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "json" || args.includes("--json")) {
    console.log(JSON.stringify(CANONICAL_REGISTRY, null, 2));
    return;
  }

  if (cmd === "summary") {
    console.log(`\n=== Bun OS Unified Component Registry (v${CANONICAL_REGISTRY.version}) ===\n`);
    console.log(`• MCP Servers : ${MCP_SERVERS.length}`);
    console.log(`• Agent Skills: ${SKILLS.length}`);
    console.log(`• Plugins     : ${PLUGINS.length}`);
    console.log(`• CLIs        : ${CLIS.length}\n`);
    console.log(`Use 'bunos-registry <mcp|skills|plugins|clis>' to view details.`);
    return;
  }

  if (cmd === "mcp") {
    console.log(`\n=== Bun OS MCP Servers (${MCP_SERVERS.length}) ===\n`);
    for (const m of MCP_SERVERS) {
      console.log(`[${m.runtime.toUpperCase()}] ${m.id} (${m.name})`);
      console.log(`  Path   : ${m.path}`);
      console.log(`  Command: ${m.command}`);
      console.log(`  Desc   : ${m.description}\n`);
    }
    return;
  }

  if (cmd === "skills") {
    console.log(`\n=== Bun OS Agent Skills (${SKILLS.length}) ===\n`);
    for (const s of SKILLS) {
      console.log(`[${s.category.toUpperCase()}] ${s.name} (${s.package})`);
      console.log(`  Path: ${s.path}`);
      console.log(`  Desc: ${s.description}\n`);
    }
    return;
  }

  if (cmd === "plugins") {
    console.log(`\n=== Bun OS Plugins (${PLUGINS.length}) ===\n`);
    for (const p of PLUGINS) {
      console.log(`[${p.type}] ${p.id} (${p.runtime})`);
      console.log(`  Path : ${p.path} -> ${p.entrypoint}`);
      console.log(`  Desc : ${p.description}\n`);
    }
    return;
  }

  if (cmd === "clis") {
    console.log(`\n=== Bun OS CLIs (${CLIS.length}) ===\n`);
    for (const c of CLIS) {
      console.log(`• ${c.command} (${c.runtime}) - ${c.package}`);
      console.log(`  Path : ${c.path}`);
      console.log(`  Usage: ${c.exampleUsage}`);
      console.log(`  Desc : ${c.description}\n`);
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main();
