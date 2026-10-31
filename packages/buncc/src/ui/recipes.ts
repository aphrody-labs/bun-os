/**
 * bun-ui build recipes: one per app that `buncc build <id>` turns into a bun-ui bundle (crates/bun-ui-web, bun-ui.json),
 * plus the native engines bun-ui embeds (Servo, CEF). Paths are relative to the repository root unless absolute; `$VAR`
 * and `~` expand from the environment (BUN_UI_SRC points at a bun-ui checkout, QT_WASM_SRC at the qtbase source).
 */

export type Toolkit = "iced" | "libcosmic" | "gtk" | "qt" | "servo" | "cef";

interface Base {
  id: string;
  toolkit: Toolkit;
  title: string;
  /** Initial window size in the host. */
  size?: [number, number];
  notes?: string;
}

/** Rust app for wasm32-unknown-unknown + wasm-bindgen (iced, libcosmic). */
export interface CargoWasmRecipe extends Base {
  kind: "cargo-wasm";
  /** Cargo workspace or package directory. */
  dir: string;
  package?: string;
  example?: string;
  /** Build the cdylib (`--lib`) instead of an example or bin. */
  lib?: boolean;
  features?: string[];
  noDefaultFeatures?: boolean;
  /** Toolchain override (`+nightly-...`) when the workspace has none. */
  toolchain?: string;
}

/** Qt for WebAssembly: qt-cmake from the qt-wasm prefix (buncc toolchain install qt-wasm). */
export interface QtWasmRecipe extends Base {
  kind: "qt-wasm";
  source: string;
  target: string;
  cmakeArgs?: string[];
}

/** Any CMake project through emcmake (C/C++, GTK dependencies). */
export interface EmscriptenCmakeRecipe extends Base {
  kind: "emscripten-cmake";
  source: string;
  target: string;
  cmakeArgs?: string[];
}

/** Meson project cross-compiled with Emscripten (GLib/GTK stack). */
export interface EmscriptenMesonRecipe extends Base {
  kind: "emscripten-meson";
  source: string;
  /** Output html/js/wasm basename. */
  target: string;
  mesonArgs?: string[];
}

/** Native GTK 4 apps streamed by GDK Broadway (crates/bun-ui-web/broadway). */
export interface BroadwayRecipe extends Base {
  kind: "broadway";
}

/** Native engines (no bundle): Servo through mach, CEF binary distribution through cef-rs export-cef-dir. */
export interface EngineRecipe extends Base {
  kind: "servo" | "cef";
  dir: string;
}

export type Recipe =
  CargoWasmRecipe | QtWasmRecipe | EmscriptenCmakeRecipe | EmscriptenMesonRecipe | BroadwayRecipe | EngineRecipe;

export const recipes: Recipe[] = [
  {
    id: "iced-m3-gallery",
    toolkit: "iced",
    title: "Bun UI M3 gallery",
    kind: "cargo-wasm",
    dir: "$BUN_UI_SRC",
    package: "aphrody-m3-iced",
    example: "gallery",
    size: [960, 680],
    notes:
      "bun-ui's Material 3 adapter for iced 0.14 (crates/aphrody-m3-iced), wgpu on WebGPU with the WebGL2 fallback.",
  },
  {
    id: "libcosmic-calculator",
    toolkit: "libcosmic",
    title: "COSMIC Calculator",
    kind: "cargo-wasm",
    dir: "crates/bun-ui-web/apps/cosmic-calculator",
    lib: true,
    toolchain: "nightly-2026-09-15",
    size: [420, 600],
    notes: "libcosmic fork (vendor/cosmic-epoch/libcosmic) with winit + wgpu, COSMIC dark theme.",
  },
  {
    id: "qt-calculator",
    toolkit: "qt",
    title: "Qt Calculator",
    kind: "qt-wasm",
    source: "$QT_WASM_SRC/examples/widgets/widgets/calculator",
    target: "calculator",
    size: [360, 420],
    notes: "Qt Widgets example of qtbase 6.11.2 on the Qt for WebAssembly platform plugin.",
  },
  {
    id: "qt-analogclock",
    toolkit: "qt",
    title: "Qt Analog Clock",
    kind: "qt-wasm",
    source: "$QT_WASM_SRC/examples/gui/analogclock",
    target: "analogclock",
    size: [320, 340],
  },
  {
    id: "gtk-broadway",
    toolkit: "gtk",
    title: "GTK 4 apps (Broadway)",
    kind: "broadway",
    notes: "gnome-calculator, gtk4-widget-factory, gtk4-demo on loopback broadwayd, proxied by /ui/gtk/<id>/.",
  },
  {
    id: "servo",
    toolkit: "servo",
    title: "Servo",
    kind: "servo",
    dir: "$SERVO_SRC",
    notes: "aphrody-labs/servo: ./mach build --release; the iced/libcosmic webview widget embeds it off screen.",
  },
  {
    id: "cef",
    toolkit: "cef",
    title: "CEF",
    kind: "cef",
    dir: "vendor/cef-rs",
    notes: "cef-rs export-cef-dir downloads and lays out the CEF binary distribution for off-screen rendering.",
  },
];

export function findRecipe(id: string): Recipe | undefined {
  return recipes.find(recipe => recipe.id === id);
}
