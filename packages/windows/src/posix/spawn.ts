/**
 * Process spawn helpers that do not depend on a particular bash. A POSIX tool that is a native Windows executable (the
 * buncc `posix` shims: uutils, busybox-w32, ripgrep) takes Windows paths; a process of an MSYS2/Cygwin runtime converts
 * them itself. So the default is: native environment, native arguments, shim directory first on PATH.
 */
import { convertPath, looksLikePath, type PathOptions, type PathStyle } from "./path.ts";
import { prependToPath, translateEnv } from "./env.ts";

export interface PosixSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Directories put first on PATH, e.g. `process.env.BUNCC_POSIX_DIR` (buncc env posix). */
  pathPrepend?: string[];
  /** Style the child expects for path arguments and path variables. "windows" (default) for native programs. */
  childStyle?: PathStyle;
  /** Translate path-looking arguments to childStyle. Off by default: arguments are passed as given. */
  translateArgs?: boolean;
  path?: PathOptions;
}

/** argv and env the child should receive. Pure; `posixSpawn` uses it. */
export function preparePosixSpawn(argv: string[], o: PosixSpawnOptions = {}) {
  const style = o.childStyle ?? "windows";
  const base = o.env ?? (process.env as Record<string, string | undefined>);
  const hostStyle: PathStyle = process.platform === "win32" ? "windows" : "posix";
  let env = style === hostStyle ? Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) as Record<string, string> : translateEnv(base, style, hostStyle, o.path);
  if (o.pathPrepend?.length) env = prependToPath(env, o.pathPrepend, style);
  const args = o.translateArgs ? argv.map((a, i) => (i > 0 && looksLikePath(a, o.path) ? convertPath(a, style, o.path) : a)) : argv;
  const cwd = o.cwd && style !== hostStyle ? convertPath(o.cwd, hostStyle === "windows" ? "windows" : "posix", o.path) : o.cwd;
  return { argv: args, env, cwd };
}

/** Run a program and collect its output. */
export async function posixSpawn(argv: string[], o: PosixSpawnOptions = {}) {
  const prepared = preparePosixSpawn(argv, o);
  const proc = Bun.spawn(prepared.argv, { cwd: prepared.cwd, env: prepared.env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { code, stdout, stderr };
}

/** Run a shell script with Bun Shell (`Bun.$`): the same shell on every host, no bash needed. */
export async function posixShell(script: string, o: PosixSpawnOptions = {}) {
  const { $ } = await import("bun");
  const { env, cwd } = preparePosixSpawn([], o);
  let sh = $.env(env).nothrow();
  if (cwd) sh = sh.cwd(cwd);
  const r = await sh`${{ raw: script }}`.quiet();
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}
