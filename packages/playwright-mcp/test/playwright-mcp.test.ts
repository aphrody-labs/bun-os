import { describe, expect, it } from "bun:test";
import { tools, handle } from "../src/mcp.ts";

describe("@aphrody/playwright-mcp", () => {
  it("exposes all 8 standard browser automation tools", () => {
    expect(tools).toBeArray();
    expect(tools.length).toBe(8);
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_snapshot");
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_fill");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_evaluate");
    expect(names).toContain("browser_close");
  });

  it("handles initialize MCP method correctly", async () => {
    const res = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res).not.toBeNull();
    expect((res as any).result.serverInfo.name).toBe("playwright-mcp");
  });

  it("handles unknown tools with an error result in tools/call", async () => {
    const res = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "non_existent_tool", arguments: {} },
    });
    expect(res).not.toBeNull();
    expect((res as any).result.isError).toBe(true);
    expect((res as any).result.content[0].text).toContain("unknown tool");
  });
});
