export type GoogleProject = "aphrody" | "rgfr";

export type { GoogleRuntime } from "./client.ts";

/** Resolve public configuration (project, location, home, auth mode); credentials are never read. */
export { googleRuntime } from "./client.ts";
