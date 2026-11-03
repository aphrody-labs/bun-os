// `yolo rename|parse|bench|docs`: the fork's `bun rename|parse|bench|docs` built-ins, now owned by the Bun OS
// plugin registry (`@aphrody/bun-os-plugins/devtools`, also `bunos rename|parse|bench|docs`) on upstream Bun.
// They run in-process, so a compiled yolo carries them and no checkout package script can shadow them.
import { type DevtoolsCommand, run } from "@aphrody/bun-os-plugins/devtools";

export async function runBunTool(command: DevtoolsCommand, args: readonly string[], cwd: string): Promise<number> {
  return run(command, [...args], cwd);
}
