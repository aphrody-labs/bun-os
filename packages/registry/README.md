# @aphrody/registry

Unified canonical registry for Bun OS MCP servers, Agent Skills, Runtime Plugins, and CLIs.

## Features

- **MCP Servers**: Catalog of Rust and TypeScript Model Context Protocol servers.
- **Agent Skills**: Catalog of standardized AI Agent skills (`SKILL.md`).
- **Plugins**: Catalog of Bun OS and Tauri runtime plugins.
- **CLIs**: Unified command dispatch and documentation for all Bun OS binaries and tools.

## Usage

```typescript
import { listMcpServers, listSkills, listPlugins, listClis } from "@aphrody/registry";

console.log(listMcpServers());
console.log(listSkills());
```

## CLI

```bash
bun packages/registry/src/cli.ts summary
bun packages/registry/src/cli.ts mcp
bun packages/registry/src/cli.ts skills
bun packages/registry/src/cli.ts plugins
bun packages/registry/src/cli.ts clis
```
