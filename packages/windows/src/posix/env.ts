/** Environment translation between a Windows process and a POSIX layer (MSYS2, Cygwin, WSL) or back. Pure. */
import { convertPath, looksLikePath, type PathOptions, type PathStyle } from "./path.ts";

/** Variables holding a list of paths (`;` on Windows, `:` in POSIX layers). */
export const PATH_LIST_VARS = [
  "PATH",
  "CPATH",
  "C_INCLUDE_PATH",
  "CPLUS_INCLUDE_PATH",
  "LIBRARY_PATH",
  "PKG_CONFIG_PATH",
  "MANPATH",
  "INCLUDE",
  "LIB",
  "LIBPATH",
] as const;

/** Variables holding one path. */
export const PATH_VARS = ["HOME", "PWD", "OLDPWD", "TMP", "TEMP", "TMPDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "SystemRoot", "windir"] as const;

type Env = Record<string, string | undefined>;

const listSep = (style: PathStyle) => (style === "windows" ? ";" : ":");

/**
 * Split a path list. A POSIX list can hold a drive-letter Windows path (`C:\a:/b`) when a tool mixed styles: a single
 * letter followed by `:\` or `:/` is kept together with its drive.
 */
export function splitList(value: string, style: PathStyle): string[] {
  if (style === "windows") return value.split(";").filter(Boolean);
  const out: string[] = [];
  const parts = value.split(":");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (/^[A-Za-z]$/.test(part) && i + 1 < parts.length && /^[\\/]/.test(parts[i + 1]!)) {
      out.push(`${part}:${parts[++i]}`);
    } else if (part) out.push(part);
  }
  return out;
}

export function convertList(value: string, to: PathStyle, from: PathStyle, o?: PathOptions): string {
  return splitList(value, from)
    .map(p => (looksLikePath(p, o) || p.startsWith("/") ? convertPath(p, to, o) : p))
    .join(listSep(to));
}

/**
 * Translate the path-valued variables of `env` to `to`. Keys are matched case-insensitively (Windows spells `Path`);
 * the key's original spelling is kept. Other variables are copied unchanged.
 */
export function translateEnv(env: Env, to: PathStyle, from: PathStyle = to === "windows" ? "msys" : "windows", o?: PathOptions): Record<string, string> {
  const lists = new Set(PATH_LIST_VARS.map(s => s.toLowerCase()));
  const singles = new Set(PATH_VARS.map(s => s.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const k = key.toLowerCase();
    if (lists.has(k)) out[key] = convertList(value, to, from, o);
    else if (singles.has(k)) out[key] = looksLikePath(value, o) || value.startsWith("/") ? convertPath(value, to, o) : value;
    else out[key] = value;
  }
  return out;
}

/** Prepend directories to PATH (whatever its spelling) without duplicates; directories are written in `style`. */
export function prependToPath(env: Env, dirs: string[], style: PathStyle = "windows"): Record<string, string> {
  const key = Object.keys(env).find(k => k.toLowerCase() === "path") ?? "PATH";
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  const have = new Set(splitList(out[key] ?? "", style).map(s => s.toLowerCase()));
  const add = dirs.map(d => convertPath(d, style)).filter(d => !have.has(d.toLowerCase()));
  out[key] = [...add, ...(out[key] ? [out[key]] : [])].join(listSep(style));
  return out;
}
