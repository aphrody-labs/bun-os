import { describe, expect, it } from "bun:test";
import { listMcpServers, listSkills, listPlugins, listClis, getRegistry, getMcpServer } from "../src/index.ts";

describe("@aphrody/registry", () => {
  it("returns consolidated registered MCP servers", () => {
    const servers = listMcpServers();
    expect(servers.length).toBeGreaterThanOrEqual(7);
    const ids = servers.map(s => s.id);
    expect(ids).toContain("aphrody-mcp");
    expect(ids).toContain("craft-suite-mcp");
    expect(ids).toContain("playwright-mcp");
    expect(ids).toContain("bun-arch-mcp");
    expect(ids).toContain("m3-mcp");
    expect(ids).toContain("gws-mcp");

    const craftSuite = servers.find(s => s.id === "craft-suite-mcp");
    expect(craftSuite?.subsumes).toContain("cadcraft-mcp");
    expect(craftSuite?.subsumes).toContain("vectorcraft-mcp");
  });

  it("returns all registered skills", () => {
    const skills = listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(20);
    const names = skills.map(s => s.name);
    expect(names).toContain("arch-linux");
    expect(names).toContain("ui-ux-pro-max");
  });

  it("finds component by ID", () => {
    const found = getMcpServer("aphrody-mcp");
    expect(found).not.toBeUndefined();
    expect(found?.runtime).toBe("rust");
  });

  it("produces valid consolidated registry data", () => {
    const reg = getRegistry();
    expect(reg.mcpServers.length).toBeGreaterThanOrEqual(7);
    expect(reg.skills.length).toBeGreaterThanOrEqual(20);
    expect(reg.plugins.length).toBeGreaterThanOrEqual(4);
    expect(reg.clis.length).toBeGreaterThanOrEqual(5);

    const bunosCli = reg.clis.find(c => c.command === "bunos");
    expect(bunosCli).not.toBeUndefined();
    expect(bunosCli?.subsumes).toContain("cli-wasm");

    const aphrodyCli = reg.clis.find(c => c.command === "aphrody");
    expect(aphrodyCli).not.toBeUndefined();
    expect(aphrodyCli?.subsumes).toContain("cadcraft-cli");
  });
});
