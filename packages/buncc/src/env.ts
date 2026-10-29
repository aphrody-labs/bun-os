import { existsSync } from "node:fs";
import { delimiter } from "node:path";

/** Environment variables that hold ONE path to a file or directory. A stale value breaks the tool that reads it. */
export const SINGLE_PATH_VARS = [
  "PROTOC",
  "PROTOC_INCLUDE",
  "LIBCLANG_PATH",
  "SCCACHE_PATH",
  "VCPKG_ROOT",
  "CMAKE",
  "CMAKE_TOOLCHAIN_FILE",
  "WindowsSdkDir",
  "VCINSTALLDIR",
  "VSINSTALLDIR",
] as const;

/** Variables that hold a PATH-style list. Entries that do not exist are dropped. */
export const LIST_PATH_VARS = [
  "INCLUDE",
  "LIB",
  "LIBPATH",
  "CPATH",
  "C_INCLUDE_PATH",
  "CPLUS_INCLUDE_PATH",
  "LIBRARY_PATH",
  "CMAKE_PREFIX_PATH",
  "PKG_CONFIG_PATH",
] as const;

/** Variables naming an executable, optionally followed by arguments (`ccache gcc`). Dropped when the program is missing. */
export const PROGRAM_VARS = ["RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "CC", "CXX", "AR", "LINKER"] as const;

export type Env = Record<string, string | undefined>;

export interface SanitizeResult {
  env: Env;
  dropped: { name: string; value: string; reason: string }[];
}

export interface SanitizeOptions {
  exists?: (path: string) => boolean;
  /** Resolve a bare program name to a path, as `Bun.which` does. */
  which?: (program: string) => string | null | undefined;
  /** Windows compares variable names case-insensitively. */
  caseInsensitive?: boolean;
}

/** Find the real key of a variable in an env object. */
export function envKey(env: Env, name: string, caseInsensitive = process.platform === "win32"): string | undefined {
  if (name in env) return name;
  if (!caseInsensitive) return undefined;
  const lower = name.toLowerCase();
  return Object.keys(env).find(key => key.toLowerCase() === lower);
}

/**
 * Drop stale paths from a build environment: a PROTOC_INCLUDE that points at a removed SDK, a RUSTC_WRAPPER whose
 * program is gone, list entries in INCLUDE/LIB that do not exist. Pure given `exists`/`which`.
 */
export function sanitizeEnv(input: Env, options: SanitizeOptions = {}): SanitizeResult {
  const exists = options.exists ?? existsSync;
  const which = options.which ?? ((program: string) => Bun.which(program));
  const ci = options.caseInsensitive ?? process.platform === "win32";
  const env: Env = { ...input };
  const dropped: SanitizeResult["dropped"] = [];
  const drop = (key: string, reason: string) => {
    dropped.push({ name: key, value: env[key] ?? "", reason });
    delete env[key];
  };
  for (const name of SINGLE_PATH_VARS) {
    const key = envKey(env, name, ci);
    const value = key ? env[key] : undefined;
    if (key && value !== undefined && (value === "" || !exists(value))) drop(key, "path does not exist");
  }
  for (const name of LIST_PATH_VARS) {
    const key = envKey(env, name, ci);
    const value = key ? env[key] : undefined;
    if (!key || value === undefined) continue;
    const parts = value.split(delimiter).filter(Boolean);
    const kept = parts.filter(part => exists(part));
    if (kept.length === parts.length) continue;
    for (const part of parts)
      if (!kept.includes(part)) dropped.push({ name: key, value: part, reason: "entry does not exist" });
    if (kept.length) env[key] = kept.join(delimiter);
    else delete env[key];
  }
  for (const name of PROGRAM_VARS) {
    const key = envKey(env, name, ci);
    const value = key ? env[key]?.trim() : undefined;
    if (!key || value === undefined) continue;
    if (value === "") {
      drop(key, "empty");
      continue;
    }
    const program = splitProgram(value);
    const resolved = which(program) ?? (exists(program) ? program : null);
    if (!resolved) drop(key, "program not found");
  }
  return { env, dropped };
}

/** First token of a program variable, honouring a quoted path with spaces. */
export function splitProgram(value: string): string {
  const quoted = /^"([^"]+)"/.exec(value);
  if (quoted) return quoted[1]!;
  if (existsSync(value)) return value;
  return value.split(/\s+/)[0] ?? value;
}

/** Parse the output of `set` (cmd) or `env` into a map. Lines without `=` or starting with `=` (cmd drive vars) are skipped. */
export function parseEnvDump(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}

/** Keep only the variables a captured environment adds or changes relative to a base (case-insensitive on Windows). */
export function diffEnv(
  base: Env,
  captured: Record<string, string>,
  caseInsensitive = process.platform === "win32",
): Record<string, string> {
  const baseByKey = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(base)) baseByKey.set(caseInsensitive ? key.toLowerCase() : key, value);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(captured)) {
    const previous = baseByKey.get(caseInsensitive ? key.toLowerCase() : key);
    if (previous !== value) out[key] = value;
  }
  return out;
}

/** Overlay `extra` onto `base`, reusing the base's existing key casing. */
export function overlayEnv(
  base: Env,
  extra: Record<string, string | undefined>,
  caseInsensitive = process.platform === "win32",
): Env {
  const out: Env = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = envKey(out, key, caseInsensitive) ?? key;
    if (value === undefined) delete out[existing];
    else out[existing] = value;
  }
  return out;
}
