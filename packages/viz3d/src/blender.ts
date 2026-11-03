// SPDX-License-Identifier: MIT
// Port of upstream scripts/blender_locate.py on the Bun OS Blender owner (@aphrody/bun-blender): find a Blender that
// runs, without asking the user to fix PATH. Candidates come from blenderCandidates() (BLENDER_PATH, PATH, the
// install locations); `--version` runs on each in turn, so a broken install reports found: false rather than a path
// that cannot run. Shared by host-probe and hero-tier so the two never disagree. Never installs.
import { blenderCandidates } from "@aphrody/bun-blender";

/** Oldest LTS the T3 pipeline was written against. */
export const MIN_VERSION: [number, number] = [4, 2];

export interface BlenderFound {
  found: boolean;
  path: string | null;
  version: string | null;
  on_path: boolean;
  meets_minimum: boolean;
  source: string;
}

/** '5.2.1' from `blender --version`, or null when it cannot run. */
export async function blenderVersion(path: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const proc = Bun.spawn([path, "--version"], { stdout: "pipe", stderr: "ignore", timeout: timeoutMs, windowsHide: true });
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const match = /Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
    return match ? match.slice(1).filter(Boolean).join(".") : null;
  } catch {
    return null;
  }
}

export async function findBlender(): Promise<BlenderFound> {
  for (const candidate of await blenderCandidates()) {
    const version = await blenderVersion(candidate.executable);
    if (!version) continue;
    const [major = 0, minor = 0] = version.split(".").map(Number);
    const onPath = candidate.source === "PATH";
    return {
      found: true,
      path: candidate.executable,
      version,
      on_path: onPath,
      meets_minimum: major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]),
      source: `${candidate.source} + --version`,
    };
  }
  return {
    found: false,
    path: null,
    version: null,
    on_path: false,
    meets_minimum: false,
    source: "no runnable candidate on BLENDER_PATH, PATH or standard paths",
  };
}
