// SPDX-License-Identifier: 0BSD
/**
 * default/ vs user layering and hooks, after Omarchy (omacom/omarchy 84782475aeb8):
 *  - bin/omarchy-refresh-config: copy the package copy of a config file over the user's, keeping the old one as
 *    `<file>.bak.<epoch>`; an identical file is left alone (Omarchy writes the backup first and removes it).
 *  - bin/omarchy-hook: `~/.config/omarchy/hooks/<name>` then every file of `<name>.d/` (not `*.sample`); a failing
 *    hook is reported and does not abort the caller.
 * Bun OS names: package copy `/usr/share/bunos/config`, user tree `~/.config/bunos`, hooks `~/.config/bunos/hooks`.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface RefreshResult {
  target: string;
  action: "created" | "unchanged" | "replaced";
  backup?: string;
}

export async function refreshConfig(options: {
  packageDir: string;
  userDir: string;
  rel: string;
  epoch?: number;
}): Promise<RefreshResult> {
  if (options.rel.split(/[\\/]/).includes("..") || options.rel.startsWith("/"))
    throw new Error(`invalid path: ${options.rel}`);
  const source = join(options.packageDir, options.rel);
  const target = join(options.userDir, options.rel);
  if (!existsSync(source)) throw new Error(`no package copy of ${options.rel}`);
  await mkdir(dirname(target), { recursive: true });
  if (!existsSync(target)) {
    await copyFile(source, target);
    return { target, action: "created" };
  }
  const [a, b] = await Promise.all([readFile(source), readFile(target)]);
  if (Buffer.compare(a, b) === 0) return { target, action: "unchanged" };
  const backup = `${target}.bak.${options.epoch ?? Math.trunc(Date.now() / 1000)}`;
  await rename(target, backup);
  await copyFile(source, target);
  return { target, action: "replaced", backup };
}

export interface HookResult {
  ran: string[];
  failed: { file: string; code: number }[];
}

export type HookRunner = (file: string, args: string[]) => Promise<number>;
const bashRunner: HookRunner = async (file, args) =>
  await Bun.spawn(["bash", file, ...args], { stdout: "inherit", stderr: "inherit", stdin: "ignore" }).exited;

export async function runHook(
  hooksDir: string,
  name: string,
  args: string[] = [],
  runner: HookRunner = bashRunner,
): Promise<HookResult> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid hook name: ${name}`);
  const files: string[] = [];
  const main = join(hooksDir, name);
  if (existsSync(main)) files.push(main);
  const dir = `${main}.d`;
  if (existsSync(dir)) {
    for (const f of (await readdir(dir)).sort()) if (!f.endsWith(".sample")) files.push(join(dir, f));
  }
  const result: HookResult = { ran: [], failed: [] };
  for (const file of files) {
    const code = await runner(file, args);
    if (code === 0) result.ran.push(file);
    else {
      result.failed.push({ file, code });
      console.error(`Hook failed: ${file} (exit ${code})`);
    }
  }
  return result;
}

/** Hook names Bun OS fires; `sched-ext` is the kernel-control-plane hook (docs/KERNEL-ROADMAP.md Phase 3). */
export const hookNames = ["post-update", "post-migrate", "theme-set", "sched-ext"] as const;
