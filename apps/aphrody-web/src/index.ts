/**
 * Aphrody Web Entrypoint (aphrody.com)
 * Initializes WebGPU shaders, mounts OKLCH theme variables, and manages interactive hubs.
 */

import { generateCssVariables } from "@aphrody/craft-ui/tokens";
import { GlassShaderController } from "@aphrody/craft-ui/shaders";

export function bootAphrodyWeb() {
  // Inject OKLCH CSS variables into document root
  const styleEl = document.createElement("style");
  styleEl.textContent = `:root {\n${generateCssVariables(true)}\n}`;
  document.head.appendChild(styleEl);

  // Initialize WebGPU / Canvas2D shader pipeline
  const canvas = document.getElementById("shader-canvas") as HTMLCanvasElement | null;
  if (canvas) {
    const resize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    const glassController = new GlassShaderController({
      canvas,
      roughness: 0.06,
      dispersion: 0.18,
      refractionIndex: 1.15,
      ambientIntensity: 1.3,
    });
    glassController.start().catch((err: unknown) => {
      console.warn("Shader init error:", err);
    });
  }

  console.log("Aphrody Web (aphrody.com) initialized successfully with OKLCH + WebGPU.");
}

// Auto-boot if running in browser
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    bootAphrodyWeb();
  });
}
