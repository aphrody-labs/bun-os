// SPDX-License-Identifier: Apache-2.0
// Keep host and nested M3 workspaces on the application's React instance.
// The same resolver runs in production, development and behavioral tests.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BunPlugin } from "bun";
import { findWorkspaceRoot } from "@aphrody/paths";

const here = import.meta.dir;

export const undeclaredDependencies: BunPlugin = {
  name: "app-ui-shared-dependencies",
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, args => ({
      path: Bun.resolveSync(args.path, here).replaceAll("\\", "/"),
    }));
    build.onResolve({ filter: /^@aphrody\/plugin-([a-z-]+)$/ }, args => {
      const pluginName = args.path.replace("@aphrody/plugin-", "");
      const workspaceRoot = findWorkspaceRoot(here, process.env);
      const guestJs = join(workspaceRoot, `crates/tauri/aphrody-tauri-plugin-${pluginName}/guest-js/index.ts`);
      if (existsSync(guestJs)) {
        return { path: guestJs.replaceAll("\\", "/") };
      }
      return undefined;
    });
    build.onResolve({ filter: /^(framework-utils|@daybrush\/utils)$/ }, args => {
      if (!args.importer.replaceAll("\\", "/").includes("/react-selecto/")) return undefined;
      const selectoDir = dirname(Bun.resolveSync("selecto/package.json", args.importer));
      for (const from of [selectoDir, here]) {
        try {
          return {
            path: Bun.resolveSync(args.path, from).replaceAll("\\", "/"),
          };
        } catch {
          // Try the next declared dependency owner.
        }
      }
      return undefined;
    });
    build.onResolve({ filter: /^tiny-invariant$/ }, () => ({
      path: "tiny-invariant",
      namespace: "tiny-invariant-virtual",
    }));
    build.onLoad({ filter: /.*/, namespace: "tiny-invariant-virtual" }, () => ({
      contents: `
const prefix = "Invariant failed";
export default function invariant(condition, message) {
  if (condition) return;
  const provided = typeof message === "function" ? message() : message;
  throw new Error(provided ? \`\${prefix}: \${provided}\` : prefix);
}
`,
      loader: "js",
    }));
  },
};
export default undeclaredDependencies;
