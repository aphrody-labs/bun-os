import { resolve } from "node:path";

/** Resolve the workspace CLI source for integration tests without making it a package dependency. */
export const yoloCliPath = resolve(import.meta.dir, "../../yolo-cli/src/index.ts");
