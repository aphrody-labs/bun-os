// SPDX-License-Identifier: Apache-2.0
import { withM3 } from "@aphrody/m3-next";
import { resolve } from "node:path";

// `tauri: true` is the static export a Tauri webview loads: `output: "export"`, unoptimized images, trailing slashes,
// no Cache Components, and `M3Root` stops reading the request cookie (there is no request). With `tauri: "auto"` the
// same config also serves `next dev` from the browser and exports only when the Tauri CLI runs the build.
export default withM3(
  // Types are checked by `bun check` (`typecheck` script), not during `next build`.
  { typescript: { ignoreBuildErrors: true } },
  {
    typedRoutes: true,
    reactCompiler: false,
    tauri: true,
    turbopackRoot: resolve(process.cwd(), "../.."),
  },
);
