// SPDX-License-Identifier: MIT
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";

const HERE = import.meta.dir;

/** Resolve the workspace owning this engine, independent of the caller's working directory. */
export function engineWorkspaceRoot(from = HERE, env: Record<string, string | undefined> = process.env): string {
  const bunOsRoot = env.BUN_OS_ROOT?.trim();
  if (bunOsRoot && existsSync(bunOsRoot)) return bunOsRoot;
  const configured = env.APHRODY_WORKSPACE_ROOT?.trim() || env.APHRODY_ROOT?.trim();
  if (configured) return findWorkspaceRoot(undefined, env);
  try {
    return findWorkspaceRoot(from, env);
  } catch {
    return resolve(from, "..", "..", "..", "..");
  }
}

/** Locate the native engine built for this checkout, including BunCC's isolated worker slots. */
export function findEngine(from = HERE, env: Record<string, string | undefined> = process.env): string | undefined {
  const name = "bun-engine";
  const override = env.BUN_ENGINE_NATIVE;
  if (override && existsSync(override)) return override;

  const suffix = process.platform === "win32" ? ".exe" : "";
  const file = `${name}${suffix}`;
  const root = engineWorkspaceRoot(from, env);
  const localAppData = env.LOCALAPPDATA;
  const bases = [
    join(root, "target"),
    env.CARGO_TARGET_DIR,
    localAppData && join(localAppData, "Aphrody", "cache", "cargo-target"),
    localAppData && join(localAppData, "aphrody", "target"),
  ].filter((base): base is string => Boolean(base));

  let best: { path: string; mtime: number } | undefined;
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const targets = [base];
    for (const slot of new Bun.Glob("slot-*").scanSync({
      cwd: base,
      onlyFiles: false,
    }))
      targets.push(join(base, slot));
    for (const target of targets)
      for (const profile of ["release", "debug"]) {
        const path = join(target, profile, file);
        if (!existsSync(path)) continue;
        const mtime = statSync(path).mtimeMs;
        if (!best || mtime > best.mtime) best = { path, mtime };
      }
  }
  return best?.path ?? Bun.which(name) ?? undefined;
}
