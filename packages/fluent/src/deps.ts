// Pinned Fluent sources. Installed into a scratch directory (never into the workspace lockfile), like packages/wasmos does for its dev dependencies.
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const PINS = { "@fluentui/react-theme": "9.2.2", "@fluentui/web-components": "3.1.3" } as const;

export async function installFluent(dir = join(tmpdir(), "bunos-fluent-deps")): Promise<string> {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, "node_modules", "@fluentui", "web-components"))) {
    await Bun.write(join(dir, "package.json"), "{}");
    const p = Bun.spawn([process.execPath, "add", ...Object.entries(PINS).map(([n, v]) => `${n}@${v}`)], { cwd: dir, stdout: "inherit", stderr: "inherit" });
    if ((await p.exited) !== 0) throw new Error("bun add failed");
  }
  return dir;
}
