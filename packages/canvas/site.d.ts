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
