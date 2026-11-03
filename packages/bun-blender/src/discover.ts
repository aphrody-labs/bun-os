import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BlenderInstall } from "./types.ts";

const SEARCH_ROOTS: Record<string, string[]> = {
  win32: [`${Bun.env.LOCALAPPDATA ?? ""}/Programs`, "C:/src/blender-build", "C:/Program Files/Blender Foundation"],
  darwin: ["/Applications"],
  linux: ["/opt", "/usr/local"],
};

/** Fixed install locations of the official packages (app bundle, distro, snap, flatpak). */
const STANDARD_PATHS: Record<string, string[]> = {
  darwin: ["/Applications/Blender.app/Contents/MacOS/Blender", join(homedir(), "Applications/Blender.app/Contents/MacOS/Blender")],
  linux: ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/var/lib/flatpak/exports/bin/org.blender.Blender"],
};

async function scan(pattern: string, cwd: string, onlyFiles = true): Promise<string[]> {
  const hits: string[] = [];
  try {
    for await (const hit of new Bun.Glob(pattern).scan({ cwd, onlyFiles })) hits.push(hit);
  } catch {
    // missing root
  }
  return hits.sort();
}

export interface BlenderCandidate {
  executable: string;
  /** How it was found: BLENDER_PATH, PATH, or an install location. */
  source: "BLENDER_PATH" | "PATH" | "standard install path";
}

/** Every Blender executable that exists, in discovery order: BLENDER_PATH, PATH, newest installs first. */
export async function blenderCandidates(): Promise<BlenderCandidate[]> {
  const out: BlenderCandidate[] = [];
  if (Bun.env.BLENDER_PATH) out.push({ executable: Bun.env.BLENDER_PATH, source: "BLENDER_PATH" });
  const which = Bun.which("blender");
  if (which) out.push({ executable: which, source: "PATH" });
  const pattern = process.platform === "win32" ? "{Blender*,bin}/blender.exe" : "[Bb]lender*/blender";
  for (const root of SEARCH_ROOTS[process.platform] ?? []) {
    for (const hit of (await scan(pattern, root)).reverse()) out.push({ executable: join(root, hit), source: "standard install path" });
  }
  for (const path of STANDARD_PATHS[process.platform] ?? []) out.push({ executable: path, source: "standard install path" });
  const seen = new Set<string>();
  const existing: BlenderCandidate[] = [];
  for (const candidate of out) {
    if (seen.has(candidate.executable)) continue;
    seen.add(candidate.executable);
    if (await Bun.file(candidate.executable).exists()) existing.push(candidate);
  }
  return existing;
}

export async function findBlender(): Promise<BlenderInstall | null> {
  for (const { executable } of await blenderCandidates()) {
    const root = dirname(executable);
    const version = (await scan("[0-9]*.[0-9]*", root, false)).at(-1) ?? null;
    const dll = (await scan("python3[0-9]*.dll", root)).at(-1);
    return { executable, root, version, python: dll ? join(root, dll) : null };
  }
  return null;
}

export async function requireBlender(): Promise<BlenderInstall> {
  const found = await findBlender();
  if (!found) throw new Error("Blender not found: set BLENDER_PATH or add blender to PATH");
  return found;
}
