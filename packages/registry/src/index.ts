// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical registry API for Bun OS.
 */

export * from "./types.ts";
export * from "./data.ts";
import { CANONICAL_REGISTRY, CLIS, MCP_SERVERS, PLUGINS, SKILLS } from "./data.ts";
import type { BunOsRegistry, CliInfo, McpServerInfo, PluginInfo, SkillInfo } from "./types.ts";

export function getRegistry(): BunOsRegistry {
  return CANONICAL_REGISTRY;
}

export function listMcpServers(): McpServerInfo[] {
  return MCP_SERVERS;
}

export function getMcpServer(id: string): McpServerInfo | undefined {
  return MCP_SERVERS.find((s) => s.id === id);
}

export function listSkills(): SkillInfo[] {
  return SKILLS;
}

export function getSkill(name: string): SkillInfo | undefined {
  return SKILLS.find((s) => s.name === name);
}

export function listPlugins(): PluginInfo[] {
  return PLUGINS;
}

export function getPlugin(id: string): PluginInfo | undefined {
  return PLUGINS.find((p) => p.id === id);
}

export function listClis(): CliInfo[] {
  return CLIS;
}

export function getCli(command: string): CliInfo | undefined {
  return CLIS.find((c) => c.command === command);
}
