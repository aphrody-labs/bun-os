/**
 * @file inagle-ui/src/index.ts
 * @description Explorer/maps UI helpers of Inagle. The implementation (menu explorer, maps, asset manifest,
 * terminal colours) stays in its canonical package `@aphrody/inagle` (iecode `packages/inagle`, export
 * `./ui`), whose siblings it needs; this package re-exports it for NIE UI consumers in the iecode workspace.
 */
export * from "@aphrody/inagle/ui";
