// Declarations only: never import a sibling `.ts` here, or consumers would type-check the shipped
// sources. The site contract below is re-declared verbatim from `site.d.ts` (vendor.test.ts).
import type { Render3dPolicy, Scene, Scene3d } from "./scene-types.js";
import type { Canvas, Image, SvgCanvas, SvgExportFlag } from "./vendor/index.js";

export declare const aphrodyCanvasRuntime: "aphrody-canvas/skia";
export declare const aphrodyCanvasVersion: "1.4.7";
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
/** `HTMLCanvasElement` with the DOM lib; a structural stand-in for server-only consumers. */
export type BrowserCanvasElement = typeof globalThis extends {
  HTMLCanvasElement: { prototype: infer Element };
}
  ? Element
  : { width: number; height: number; getContext(contextId: string): unknown };
export declare function isBrowserCanvasAvailable(): boolean;
export declare function selectCanvasBackend(preferred?: CanvasBackend): CanvasBackend;
export declare function createM3CanvasSurface(options?: Partial<M3CanvasSurface>): M3CanvasSurface;
export declare function configureBrowserCanvas(
  canvas: BrowserCanvasElement,
  options: AphrodyCanvasOptions,
): BrowserCanvasElement;
export declare function createBrowserCanvas(options: AphrodyCanvasOptions): BrowserCanvasElement;

export declare function isNativeCanvasAvailable(): boolean;
export declare function loadNativeCanvas(): Promise<typeof import("./vendor/index.js")>;
export declare function createNativeCanvas(width: number, height: number): Promise<Canvas>;
export declare function createNativeCanvas(width: number, height: number, flag: SvgExportFlag): Promise<SvgCanvas>;
export declare function loadNativeImage(source: string | Uint8Array): Promise<Image>;
export declare function clearNativeCanvasCache(): Promise<void>;

/** Mirrors `aphrody_render::scene::Scene` (drift-checked copy of `@aphrody/bun`'s wire types). */
export type M3Scene = Scene;
/** Mirrors `aphrody_render::scene3d::Scene3d`. */
export type M3Scene3d = Scene3d;
export type M3Render3dPolicy = Render3dPolicy;
/** Requires the optional peer dependency `@aphrody/bun`. */
export declare function drawM3Scene(scene: M3Scene): Promise<Canvas>;
/** Requires the optional peer dependency `@aphrody/bun`. */
export declare function drawM3Scene3d(scene: M3Scene3d, policy?: M3Render3dPolicy): Promise<Canvas>;

export * from "./vendor/index.js";
export { default } from "./vendor/index.js";
