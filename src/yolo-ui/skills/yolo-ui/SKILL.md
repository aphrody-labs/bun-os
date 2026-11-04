---
name: yolo-ui
description: Dynamic, customizable pure Rust and Bun OS UI, GPU and 3D design engine replacing legacy M3. Covers adaptive color theory, contrast auditing (WCAG 2.2 AAA/APCA), WebGPU shader pipelines, and 3D scene composition.
---

# YOLO UI — Dynamic Pure Rust & Bun OS Design, GPU & 3D System

`yolo-ui` is the unified, dynamic, and fully customizable design and visualization system for Bun OS. It supersedes legacy static Material 3 (M3) architectures by providing reactive tokens, pure Rust color math, WebGPU shaders, and procedural 3D scene graphs.

---

## 1. Core Principles

1. **Pure Rust + Bun OS Native**:
   - Zero reliance on bloated external Node.js wrappers or rigid legacy CSS frameworks.
   - Core color math, contrast evaluations, and token generators are implemented in high-performance Rust (`yolo-ui-core` / `crates/bunos-design`) and native Bun TypeScript (`src/yolo-ui`).
2. **Infinite Customizability**:
   - Unlike legacy M3's restricted 49-token schema, YOLO UI supports freeform harmonic palettes, custom aesthetic modes (`cosmic`, `glass`, `neobrutal`, `cyberpunk`, `classic`), and arbitrary accent injections.
3. **WebGPU & 3D Native (wgpu 30)**:
   - GPU-accelerated styling with dynamic WGSL mesh gradient shaders and procedural 3D scene composition for Obscura browser and native desktop shells.

---

## 2. Dynamic Palette & Theme Generation

### Using TypeScript API (`@aphrody/yolo-ui`)
```typescript
import { generateYoloTheme, exportCssTokens, exportRustTokens, checkWcag } from "./src/yolo-ui/src/index.ts";

// Generate a dark cosmic theme with custom accent
const theme = generateYoloTheme("#6366f1", {
  mode: "dark",
  style: "cosmic",
  accentOverride: "#f43f5e",
});

// Export tokens for Web (CSS) and Desktop (Rust Iced/LibCosmic)
const css = exportCssTokens(theme);
const rust = exportRustTokens(theme);

// Verify WCAG 2.2 compliance
const contrast = checkWcag(theme.palette.textPrimary, theme.palette.surface);
console.log(`Contrast ratio: ${contrast.ratio}:1 (AAA: ${contrast.aaa})`);
```

---

## 3. GPU Acceleration & Shaders (WebGPU / WGSL)

Generate optimized shaders dynamically:
```typescript
import { generateWgslShader, probeGpuCapabilities } from "./src/yolo-ui/src/index.ts";

const caps = probeGpuCapabilities();

// Compile a dynamic mesh gradient shader
const wgsl = generateWgslShader({
  type: "gradient_mesh",
  primaryColorRgb: [99, 102, 241],
  accentColorRgb: [244, 63, 94],
  intensity: 1.2,
});
```

---

## 4. 3D Scene Composition & Blueprints

Compose 3D scenes procedurally:
```typescript
import { compose3dScene, exportSceneJson } from "./src/yolo-ui/src/index.ts";

const scene = compose3dScene("HeroProduct", {
  primaryColor: "#6366f1",
  accentColor: "#ec4899",
  style: "product_showcase",
});

const jsonBlueprint = exportSceneJson(scene);
```

---

## 5. MCP Tools Reference (`yolo-ui-mcp`)

The YOLO UI MCP server exposes standard tools:
- `yolo_ui_theme_generate`: Generate dynamic palettes and token sets.
- `yolo_ui_contrast_verify`: Check WCAG 2.2 AA and AAA contrast ratings.
- `yolo_ui_export_tokens`: Export CSS variables or pure Rust tokens.
- `yolo_gpu_capabilities`: Inspect host GPU adapter, limits, and compute support.
- `yolo_gpu_shader_wgsl`: Generate WGSL gradient or PBR shaders.
- `yolo_3d_scene_compose`: Build 3D scenes and lighting configurations.
