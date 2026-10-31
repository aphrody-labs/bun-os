/** Chrome uses the existing Chromium capability owner and module identity. */
declare module "bun:chrome" {
  export * from "bun:chromium";
  export { default } from "bun:chromium";
}
