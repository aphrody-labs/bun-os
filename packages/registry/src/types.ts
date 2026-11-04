// SPDX-License-Identifier: Apache-2.0
/**
 * Types for the canonical Bun OS component registry:
 * MCP servers, Agent Skills, Runtime Plugins, and CLIs.
 */

export type ComponentStatus = "stable" | "experimental" | "preview" | "deprecated";

export type ComponentRuntime = "rust" | "bun" | "tauri" | "wasm" | "hybrid";

export interface McpServerInfo {
  id: string;
  name: string;
  runtime: ComponentRuntime;
  path: string;
  description: string;
  command: string;
  status: ComponentStatus;
  tools?: string[];
  resources?: string[];
  subsumes?: string[];
}

export interface SkillInfo {
  name: string;
  description: string;
  package: string;
  path: string;
  category: "architecture" | "ui-ux" | "design" | "reverse-engineering" | "system" | "automation";
  status: ComponentStatus;
}

export interface PluginInfo {
  id: string;
  name: string;
  type: "bun-plugin" | "tauri-plugin" | "agent-plugin" | "shell-plugin";
  runtime: ComponentRuntime;
  path: string;
  description: string;
  status: ComponentStatus;
  entrypoint: string;
  subsumes?: string[];
}

export interface CliInfo {
  command: string;
  package: string;
  path: string;
  description: string;
  runtime: ComponentRuntime;
  status: ComponentStatus;
  exampleUsage: string;
  subsumes?: string[];
}

export interface BunOsRegistry {
  version: string;
  lastUpdated: string;
  mcpServers: McpServerInfo[];
  skills: SkillInfo[];
  plugins: PluginInfo[];
  clis: CliInfo[];
}
