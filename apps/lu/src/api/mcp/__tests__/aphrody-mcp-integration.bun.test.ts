/// <reference types="bun" />
import { expect, mock, test } from "bun:test";

const executable = Bun.which("aphrody-mcp");

class Events {
  private handlers = new Map<string, (value: string) => void>();
  on(event: string, handler: (value: string) => void) {
    this.handlers.set(event, handler);
  }
  emit(event: string, value = "") {
    this.handlers.get(event)?.(value);
  }
}

mock.module("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: () => {
      const stdout = new Events();
      const stderr = new Events();
      const events = new Events();
      return {
        stdout,
        stderr,
        on: events.on.bind(events),
        async spawn() {
          const process = Bun.spawn([executable!], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
          void (async () => {
            const reader = process.stdout.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              stdout.emit("data", decoder.decode(chunk.value, { stream: true }));
            }
          })();
          void process.exited.then(() => events.emit("close"));
          return {
            pid: process.pid,
            async write(text: string) {
              process.stdin.write(text);
              process.stdin.flush();
            },
            async kill() {
              process.kill();
              await process.exited;
            },
          };
        },
      };
    },
  },
}));

test.skipIf(!executable)(
  "LU MCP client discovers and calls the installed Aphrody server",
  async () => {
    const { MCPExternalClient } = await import("../external-client");
    const { ToolRegistry } = await import("../tool-registry");
    const client = new MCPExternalClient({
      id: "aphrody-test",
      name: "Aphrody",
      command: "aphrody-mcp",
      args: [],
      enabled: true,
    });
    const registry = new ToolRegistry();
    try {
      const tools = await client.connect();
      expect(tools.some(tool => tool.name === "coreutils_status")).toBe(true);
      registry.registerExternal("aphrody-test", tools, async (name, args) => client.callTool(name, args));
      expect(registry.getToolByName("coreutils_status")?.serverId).toBe("aphrody-test");
      const result = await registry.execute("coreutils_status", {});
      expect(result.length).toBeGreaterThan(0);
      expect(result.startsWith("Error:")).toBe(false);
    } finally {
      registry.unregisterServer("aphrody-test");
      await client.disconnect();
    }
    expect(registry.getToolByName("coreutils_status")).toBeUndefined();
  },
  30000,
);
