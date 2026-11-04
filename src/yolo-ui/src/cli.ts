#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * YOLO UI CLI
 * Dynamic, customizable UI design, GPU, and 3D CLI tool for Bun OS.
 */

import { generateYoloTheme, checkWcag, exportCssTokens } from "./theme.ts";
import { probeGpuCapabilities } from "./gpu.ts";
import { compose3dScene, exportSceneJson } from "./viz3d.ts";

const [subcommand, ...args] = process.argv.slice(2);

function printHelp() {
  console.log(`
YOLO UI CLI — Dynamic Pure Rust & Bun OS Design, GPU & 3D Engine
Usage:
  yolo-ui theme <seedHex> [--mode dark|light] [--style cosmic|glass|neobrutal]
  yolo-ui contrast <colorA> <colorB>
  yolo-ui gpu
  yolo-ui 3d <sceneName> [--primary <hex>] [--accent <hex>]
  yolo-ui mcp
  yolo-ui help
`);
}

switch (subcommand) {
  case "theme": {
    const seed = args[0] || "#3b82f6";
    const mode = args.includes("--mode") ? (args[args.indexOf("--mode") + 1] as any) : "dark";
    const style = args.includes("--style") ? (args[args.indexOf("--style") + 1] as any) : "cosmic";
    const theme = generateYoloTheme(seed, { mode, style });
    console.log(exportCssTokens(theme));
    break;
  }
  case "contrast": {
    const [cA = "#000000", cB = "#ffffff"] = args;
    const res = checkWcag(cA, cB);
    console.log(`Contrast Ratio: ${res.ratio}:1 | WCAG AA: ${res.aa ? "PASS" : "FAIL"} | WCAG AAA: ${res.aaa ? "PASS" : "FAIL"}`);
    break;
  }
  case "gpu": {
    const caps = probeGpuCapabilities();
    console.log(JSON.stringify(caps, null, 2));
    break;
  }
  case "3d": {
    const name = args[0] || "Showcase";
    const primary = args.includes("--primary") ? args[args.indexOf("--primary") + 1] : "#6366f1";
    const accent = args.includes("--accent") ? args[args.indexOf("--accent") + 1] : "#ec4899";
    const scene = compose3dScene(name, { primaryColor: primary, accentColor: accent });
    console.log(exportSceneJson(scene));
    break;
  }
  case "mcp": {
    await import("./mcp.ts");
    break;
  }
  case "help":
  case "--help":
  case "-h":
  default:
    if (!subcommand) {
      printHelp();
      process.exit(0);
    }
    console.error(`Unknown subcommand: ${subcommand}`);
    printHelp();
    process.exit(1);
}
