declare module "bun:obscura" {
  import type { ChromiumBrowser, LaunchOptions as ChromiumLaunchOptions } from "bun:chromium";
  /** Connect to the shared Chromium engine's loopback CDP endpoint. */
  export const connect: typeof import("bun:chromium").connect;
  /** Discover Chromium using the same executable owner as bun:chromium. */
  export function findExecutable(): string | null;

  export interface LaunchOptions extends ChromiumLaunchOptions {
    /** The shared Chromium browser currently requires one worker. Defaults to 1. */
    workers?: number;
  }

  export interface ObscuraBrowser extends ChromiumBrowser {
    readonly engine: "chromium";
  }

  /**
   * Launch the owner Chromium through bun:chromium and await its CDP handshake.
   * Shares Chromium executable discovery and uses an isolated profile by default.
   */
  export function launch(options?: LaunchOptions): Promise<ObscuraBrowser>;

  const obscura: {
    connect: typeof connect;
    findExecutable: typeof findExecutable;
    launch: typeof launch;
  };
  export default obscura;
}
