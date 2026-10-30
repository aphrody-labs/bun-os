// SPDX-License-Identifier: Apache-2.0
// The existing desktop owns native windows; this app supplies only its UI/API sidecar.
import { runTauri as runDesktopShowcase, showcaseHostPlan } from "./tauri-host";
import { SHOWCASE_ROOT } from "./icons";

export {
  assertFactoryHost,
  CARGO_RUNNER,
  DESKTOP_ROOT,
  sidecarCommand,
} from "./tauri-host";

export function tauriHostPlan(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  which = Bun.which,
) {
  return showcaseHostPlan(args, platform, which, SHOWCASE_ROOT);
}

export async function runTauri(input: string[] = []): Promise<void> {
  await runDesktopShowcase(input, SHOWCASE_ROOT);
}

if (import.meta.main) {
  try {
    await runTauri(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
