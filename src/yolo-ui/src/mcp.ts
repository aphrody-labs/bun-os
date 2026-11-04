#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * YOLO UI Unified MCP Server
 * Standard JSON-RPC 2.0 stdio server providing dynamic UI design, GPU, and 3D tools.
 */

import { generateYoloTheme, checkWcag, exportCssTokens, exportRustTokens } from "./theme.ts";
import { probeGpuCapabilities, generateWgslShader } from "./gpu.ts";
import { compose3dScene, exportSceneJson } from "./viz3d.ts";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const YOLO_UI_TOOLS: McpTool[] = [
  {
    name: "yolo_ui_theme_generate",
    description: "Generate a dynamic, fully customizable YOLO UI theme and color palette from any seed color.",
    inputSchema: {
      type: "object",
      properties: {
        seedHex: { type: "string", description: "Base hex color code, e.g. #3b82f6" },
        mode: { type: "string", enum: ["dark", "light"], default: "dark" },
        style: { type: "string", enum: ["classic", "glass", "neobrutal", "cosmic", "cyberpunk"], default: "cosmic" },
        accentOverride: { type: "string", description: "Optional accent color override hex" },
      },
      required: ["seedHex"],
    },
  },
  {
    name: "yolo_ui_contrast_verify",
    description: "Verify WCAG 2.2 AA (4.5:1) and AAA (7.0:1) contrast ratio between two colors.",
    inputSchema: {
      type: "object",
      properties: {
        colorA: { type: "string", description: "Foreground or first hex color" },
        colorB: { type: "string", description: "Background or second hex color" },
      },
      required: ["colorA", "colorB"],
    },
  },
  {
    name: "yolo_ui_export_tokens",
    description: "Export YOLO UI theme tokens as CSS custom properties or pure Rust Iced code.",
    inputSchema: {
      type: "object",
      properties: {
        seedHex: { type: "string", description: "Seed color hex" },
        format: { type: "string", enum: ["css", "rust", "json"], default: "css" },
        mode: { type: "string", enum: ["dark", "light"], default: "dark" },
      },
      required: ["seedHex"],
    },
  },
  {
    name: "yolo_gpu_capabilities",
    description: "Probe host GPU and WebGPU adapter hardware capabilities (wgpu 30, compute, texture limits).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "yolo_gpu_shader_wgsl",
    description: "Generate optimized WebGPU WGSL shaders for UI gradient meshes or PBR 3D surfaces.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["gradient_mesh", "pbr_surface"], default: "gradient_mesh" },
        primaryHex: { type: "string", description: "Primary color hex", default: "#6366f1" },
        accentHex: { type: "string", description: "Accent color hex", default: "#ec4899" },
        intensity: { type: "number", default: 1.0 },
      },
    },
  },
  {
    name: "yolo_3d_scene_compose",
    description: "Compose a 3D scene blueprint with meshes, materials, and lights for WebGPU / Obscura preview.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the 3D scene" },
        primaryColor: { type: "string", description: "Primary material color hex" },
        accentColor: { type: "string", description: "Accent material color hex" },
        style: { type: "string", enum: ["product_showcase", "abstract_art", "hardware_rig"], default: "product_showcase" },
      },
      required: ["name", "primaryColor", "accentColor"],
    },
  },
];

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "yolo_ui_theme_generate": {
      const seed = String(args.seedHex || "#3b82f6");
      const mode = (args.mode as "dark" | "light") || "dark";
      const style = (args.style as any) || "cosmic";
      const accent = args.accentOverride ? String(args.accentOverride) : undefined;
      return generateYoloTheme(seed, { mode, style, accentOverride: accent });
    }
    case "yolo_ui_contrast_verify": {
      const a = String(args.colorA);
      const b = String(args.colorB);
      return checkWcag(a, b);
    }
    case "yolo_ui_export_tokens": {
      const seed = String(args.seedHex || "#3b82f6");
      const format = String(args.format || "css");
      const mode = (args.mode as "dark" | "light") || "dark";
      const theme = generateYoloTheme(seed, { mode });
      if (format === "css") return { css: exportCssTokens(theme) };
      if (format === "rust") return { rust: exportRustTokens(theme) };
      return { tokens: theme.tokens };
    }
    case "yolo_gpu_capabilities": {
      return probeGpuCapabilities();
    }
    case "yolo_gpu_shader_wgsl": {
      const primaryHex = String(args.primaryHex || "#6366f1");
      const accentHex = String(args.accentHex || "#ec4899");
      const type = (args.type as any) || "gradient_mesh";
      const intensity = typeof args.intensity === "number" ? args.intensity : 1.0;
      const { hexToRgb } = await import("./theme.ts");
      const pRgb = hexToRgb(primaryHex);
      const aRgb = hexToRgb(accentHex);
      const wgsl = generateWgslShader({
        type,
        primaryColorRgb: [pRgb.r, pRgb.g, pRgb.b],
        accentColorRgb: [aRgb.r, aRgb.g, aRgb.b],
        intensity,
      });
      return { wgsl };
    }
    case "yolo_3d_scene_compose": {
      const sceneName = String(args.name || "DefaultScene");
      const primaryColor = String(args.primaryColor || "#3b82f6");
      const accentColor = String(args.accentColor || "#f43f5e");
      const style = (args.style as any) || "product_showcase";
      const scene = compose3dScene(sceneName, { primaryColor, accentColor, style });
      return { scene, json: exportSceneJson(scene) };
    }
    default:
      throw new Error(`Unknown YOLO UI tool: ${name}`);
  }
}

// Stdio JSON-RPC handler for CLI invocation
if (import.meta.main) {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on("line", async line => {
    if (!line.trim()) return;
    try {
      const req = JSON.parse(line);
      if (req.method === "initialize") {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "yolo-ui-mcp", version: "1.4.7" },
            },
          })
        );
      } else if (req.method === "tools/list") {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            result: { tools: YOLO_UI_TOOLS },
          })
        );
      } else if (req.method === "tools/call") {
        const { name, arguments: params } = req.params;
        const res = await handleToolCall(name, params || {});
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] },
          })
        );
      }
    } catch (err: any) {
      console.error("YOLO UI MCP error:", err.message);
    }
  });
}
