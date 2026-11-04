// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  generateYoloTheme,
  checkWcag,
  exportCssTokens,
  exportRustTokens,
  probeGpuCapabilities,
  generateWgslShader,
  compose3dScene,
  exportSceneJson,
  handleToolCall,
  YOLO_UI_TOOLS,
} from "../src/index.ts";

describe("@aphrody/yolo-ui", () => {
  it("generates dynamic customizable themes from seed colors", () => {
    const theme = generateYoloTheme("#6366f1", { mode: "dark", style: "cosmic", accentOverride: "#f43f5e" });
    expect(theme.name).toBe("yolo-cosmic-dark");
    expect(theme.palette.primary).toBe("#6366f1");
    expect(theme.palette.accent).toBe("#f43f5e");
    expect(theme.tokens["--yolo-primary"]).toBe("#6366f1");
    expect(theme.tokens["--yolo-radius"]).toBe("10px");
  });

  it("calculates accurate WCAG 2.2 contrast ratings", () => {
    const result = checkWcag("#000000", "#ffffff");
    expect(result.ratio).toBeGreaterThan(20.0);
    expect(result.aa).toBe(true);
    expect(result.aaa).toBe(true);

    const lowContrast = checkWcag("#777777", "#888888");
    expect(lowContrast.aa).toBe(false);
    expect(lowContrast.aaa).toBe(false);
  });

  it("exports valid CSS custom properties and pure Rust tokens", () => {
    const theme = generateYoloTheme("#3b82f6");
    const css = exportCssTokens(theme);
    expect(css).toContain("--yolo-primary: #3b82f6;");
    expect(css).toContain(':root[data-theme="yolo-cosmic-dark"]');

    const rust = exportRustTokens(theme);
    expect(rust).toContain("pub struct YoloThemePalette");
    expect(rust).toContain("iced::Color::from_rgb8");
  });

  it("probes GPU capabilities accurately", () => {
    const caps = probeGpuCapabilities();
    expect(caps.backend).toBe("webgpu");
    expect(caps.supportsCompute).toBe(true);
    expect(caps.maxTextureDimension2D).toBeGreaterThanOrEqual(8192);
  });

  it("generates valid WGSL shaders for UI and 3D", () => {
    const shader = generateWgslShader({
      type: "gradient_mesh",
      primaryColorRgb: [99, 102, 241],
      accentColorRgb: [244, 63, 94],
      intensity: 1.5,
    });
    expect(shader).toContain("@vertex");
    expect(shader).toContain("@fragment");
    expect(shader).toContain("vec4<f32>");
  });

  it("composes 3D scene blueprints", () => {
    const scene = compose3dScene("ShowcaseScene", {
      primaryColor: "#6366f1",
      accentColor: "#ec4899",
      style: "product_showcase",
    });
    expect(scene.name).toBe("ShowcaseScene");
    expect(scene.meshes.length).toBeGreaterThanOrEqual(3);
    expect(scene.lights.length).toBeGreaterThanOrEqual(2);

    const json = exportSceneJson(scene);
    expect(json).toContain("ShowcaseScene");
  });

  it("handles MCP tool calls accurately", async () => {
    expect(YOLO_UI_TOOLS.length).toBeGreaterThanOrEqual(6);

    const themeRes = (await handleToolCall("yolo_ui_theme_generate", { seedHex: "#10b981" })) as any;
    expect(themeRes.palette.primary).toBe("#10b981");

    const contrastRes = (await handleToolCall("yolo_ui_contrast_verify", {
      colorA: "#000000",
      colorB: "#ffffff",
    })) as any;
    expect(contrastRes.aaa).toBe(true);

    const gpuRes = (await handleToolCall("yolo_gpu_capabilities", {})) as any;
    expect(gpuRes.backend).toBe("webgpu");
  });
});
