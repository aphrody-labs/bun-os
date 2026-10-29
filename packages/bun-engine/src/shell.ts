// `bun-engine shell [...]`: runs the native Bun OS console shell (crates/bun-os-shell, a Bevy app)
// with the same arguments (`--session`, `status`, `install-session`, ...).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { workspaceRoot } from "./formats/tools";

const exe = process.platform === "win32" ? ".exe" : "";

/** The built shell binary: BUN_OS_SHELL, then target/{release,debug} and the build slots. */
export function nativeShell(): string | undefined {
  const root = workspaceRoot();
  const name = `bun-os-shell${exe}`;
  const targets = root ? [join(root, "target")] : [];
  if (root && existsSync(join(root, "target"))) {
    for (const entry of readdirSync(join(root, "target"))) {
      if (entry.startsWith("slot-")) targets.push(join(root, "target", entry));
    }
  }
  const candidates = [
    Bun.env.BUN_OS_SHELL,
    ...targets.flatMap(dir => [join(dir, "release", name), join(dir, "debug", name)]),
  ];
  return candidates.find((path): path is string => Boolean(path && existsSync(path)));
}

export async function runShell(args: string[]): Promise<number> {
  const shell = nativeShell();
  if (!shell) {
    console.error(
      "bun-os-shell is not built: bun scripts/cargo.ts exec -- build --release -p bun-os-shell",
    );
    return 1;
  }
  const child = Bun.spawn([shell, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  return await child.exited;
}
