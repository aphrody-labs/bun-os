// SPDX-License-Identifier: Apache-2.0
import { expect, test, describe } from "bun:test";
import { DesignCompiler } from "./generator.ts";

describe("DesignCompiler React code generation", () => {
  const compiler = new DesignCompiler();

  test("should compile list-detail layout with appropriate elements", () => {
    const result = compiler.compile("Crée un split detail screen en mode compact aéré");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";

    expect(code).toContain("<ListDetail");
    expect(code).toContain("List View");
    expect(code).toContain("Detail Content");
    expect(code).not.toContain("<SupportingPane");
  });

  test("should compile supporting-pane layout with appropriate elements", () => {
    const result = compiler.compile("Crée un sidebar layout");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";

    expect(code).toContain("<SupportingPane");
    expect(code).toContain("Main Application Workspace");
    expect(code).toContain("Supporting Details");
    expect(code).not.toContain("<ListDetail");
  });

  test("should compile feed layout with cards", () => {
    const result = compiler.compile("Crée un grid cards feed");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";

    expect(code).toContain("Feed Item 1");
    expect(code).toContain("Feed Item 2");
    expect(code).toContain("Feed Item 3");
  });

  test("should inject density overrides", () => {
    const resultHigh = compiler.compile("Crée un layout dense");
    const codeHigh = resultHigh.files.find(f => f.path === "src/index.tsx")?.content || "";
    expect(codeHigh).toContain("'--md-sys-density': -2");
    expect(/\bp-6\b/.test(codeHigh)).toBe(false);

    const resultLow = compiler.compile("Crée un layout aéré");
    const codeLow = resultLow.files.find(f => f.path === "src/index.tsx")?.content || "";
    expect(codeLow).toContain("'--md-sys-density': 1");
    expect(/\bp-6\b/.test(codeLow)).toBe(false);
  });

  test("should inject thinking indicator", () => {
    const result = compiler.compile("Crée un layout avec gemini shimmer");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";

    expect(code).toContain("ThinkingIndicator");
    expect(code).toContain("Reflecting...");
  });

  test("should inject streaming hook and component", () => {
    const result = compiler.compile("Crée un layout avec streaming caret");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";

    expect(code).toContain("StreamingText");
    expect(code).toContain("useStreamingText");
    expect(code).toContain("useStreamingText(stream)");
    expect(code).toContain("stream?: AsyncIterable<string>");
    expect(code).not.toContain("mockStream");
    expect(code).not.toContain("Bun.sleep");
  });

  test("should inject action registry and router", () => {
    const result = compiler.compile("Crée un layout avec action router");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";

    expect(code).toContain("actionRegistry");
    expect(code).toContain("instance-local actions");
    expect(code).toContain("onAction?: (action: GeneratedAction) => void");
    expect(code).not.toContain("console.log");
    expect(code).not.toContain("document.querySelector");
  });

  test("dark briefs keep the role classes and make the dark roles the stylesheet default", () => {
    const result = compiler.compile("Make a dark, compact dashboard in blue");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";
    const css = result.files.find(f => f.path === "src/theme.css")?.content || "";
    expect(code).toContain("bg-background text-on-surface");
    expect(code).not.toMatch(/\b(bg|text)-neutral-\d/);
    const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0]!;
    const dark = block("\n:root");
    const light = block(':root[data-theme="light"]');
    expect(dark).toContain("color-scheme: dark;");
    expect(dark).toContain(`--md-sys-color-primary: ${result.theme.themeExport.dark.primary};`);
    expect(light).toContain("color-scheme: light;");
    expect(light).toContain(`--md-sys-color-primary: ${result.theme.themeExport.light.primary};`);
    expect(css).not.toContain("prefers-color-scheme");
  });

  test("the settings pane shows the brief's seed colour", () => {
    const result = compiler.compile("Crée un layout standard", "#0F52BA");
    const code = result.files.find(f => f.path === "src/index.tsx")?.content || "";
    expect(code).toContain('<span className="text-primary font-semibold">#0F52BA</span>');
    expect(code).not.toContain("#6750A4");
  });

  test("should export W3C tokens.json configuration alongside theme.css", () => {
    const result = compiler.compile("Crée un layout standard");
    const tokensFile = result.files.find(f => f.path === "src/tokens.json");
    expect(tokensFile).toBeDefined();

    const tokens = JSON.parse(tokensFile!.content);
    expect(tokens.color).toBeDefined();
    for (const mode of ["light", "dark"] as const) {
      expect(Object.keys(tokens.color[mode])).toHaveLength(49);
      expect(tokens.color[mode].primary).toEqual({ $type: "color", $value: result.theme.themeExport[mode].primary });
    }
  });

  test("records the design system id on the brief and keeps the canonical theme", () => {
    const result = compiler.compile("Crée un layout", undefined, "material");
    expect(result.brief.designSystemId).toBe("material");
    expect(result.files.find(f => f.path === "src/theme.css")!.content).toBe(result.theme.cssCustomProperties);
  });
});
