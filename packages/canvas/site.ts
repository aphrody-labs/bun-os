/** Native-free Aphrody Site entrypoint. */
export const aphrodyCanvasRuntime = "aphrody-canvas/skia" as const;
export const aphrodyCanvasVersion = "1.4.7" as const;
export type CanvasBackend = "browser" | "native-skia";
export interface CanvasSize {
  width: number;
  height: number;
  pixelRatio?: number;
}
export interface M3CanvasSurface {
  color: string;
  pixelRatio: number;
  density: "compact" | "comfortable" | "expanded";
  colorScheme: "light" | "dark" | "system";
}
export interface AphrodyCanvasOptions extends CanvasSize {
  backend?: CanvasBackend;
  m3?: Partial<M3CanvasSurface>;
}
export function isBrowserCanvasAvailable(): boolean {
  return typeof globalThis.document !== "undefined" && typeof globalThis.document.createElement === "function";
}
export function selectCanvasBackend(preferred?: CanvasBackend): CanvasBackend {
  return preferred ?? (isBrowserCanvasAvailable() ? "browser" : "native-skia");
}
export function createM3CanvasSurface(options: Partial<M3CanvasSurface> = {}): M3CanvasSurface {
  return {
    color: options.color ?? "var(--md-sys-color-surface, #fffbfe)",
    pixelRatio: options.pixelRatio ?? 1,
    density: options.density ?? "comfortable",
    colorScheme: options.colorScheme ?? "system",
  };
}
export function configureBrowserCanvas(canvas: HTMLCanvasElement, options: AphrodyCanvasOptions): HTMLCanvasElement {
  const ratio = options.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
  canvas.width = Math.max(1, Math.round(options.width * ratio));
  canvas.height = Math.max(1, Math.round(options.height * ratio));
  canvas.dataset["aphrodyCanvas"] = aphrodyCanvasRuntime;
  canvas.dataset["aphrodyCanvasDensity"] = options.m3?.density ?? "comfortable";
  return canvas;
}
export function createBrowserCanvas(options: AphrodyCanvasOptions): HTMLCanvasElement {
  if (!isBrowserCanvasAvailable()) throw new Error("@aphrody/canvas: browser canvas is unavailable");
  const canvas = document.createElement("canvas");
  configureBrowserCanvas(canvas, options);
  canvas.style.width = `${options.width}px`;
  canvas.style.height = `${options.height}px`;
  return canvas;
}
