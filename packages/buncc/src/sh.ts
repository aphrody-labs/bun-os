/**
 * `buncc sh`: one cross-platform shell for scripts, instead of whatever bash is installed (MSYS2, Git for Windows, Cygwin,
 * WSL). It is Bun Shell (`Bun.$`, upstream): the same builtins (cd, ls, rm, cp, mv, mkdir, cat, echo, test, ...), pipes,
 * redirects, `&&`, `||`, `;`, `$VAR`, `$(cmd)`, globs on every host. Not bash: no `for`/`case`/`if`, no arrays, no `[[`.
 * Programs that are not builtins are found on PATH, to which `buncc env posix` adds the pinned uutils/busybox shims.
 */
import { readFileSync } from "node:fs";
import { delimiter } from "node:path";
import { findShimDir } from "./providers/posix.ts";

export interface ShOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Put the posix shim directory (if provisioned) in front of PATH. Default true. */
  posix?: boolean;
  quiet?: boolean;
}

export interface ShResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Environment for a script: base env, shim directory first on PATH. */
export function shEnv(options: ShOptions = {}): Record<string, string> {
  const base = { ...(options.env ?? (Bun.env as Record<string, string | undefined>)) };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  if (options.posix !== false) {
    const dir = findShimDir();
    if (dir) {
      const key = Object.keys(out).find(k => k.toUpperCase() === "PATH") ?? "PATH";
      const parts = (out[key] ?? "").split(delimiter).filter(Boolean);
      if (!parts.includes(dir)) out[key] = [dir, ...parts].join(delimiter);
    }
  }
  return out;
}

/** Run a script text with Bun Shell. Output is captured when `quiet`, else streamed to the terminal. */
export async function runScript(script: string, options: ShOptions = {}): Promise<ShResult> {
  const { $ } = await import("bun");
  let shell = $.env(shEnv(options)).nothrow();
  if (options.cwd) shell = shell.cwd(options.cwd);
  const expanded = expandBraces(script);
  for (const form of expanded.unsupported) console.error(`buncc sh: ${form} is not supported by Bun Shell and was left as written`);
  const run = shell`${{ raw: expanded.script }}`;
  const result = await (options.quiet ? run.quiet() : run);
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/** `buncc sh -c "<script>"`, `buncc sh <file> [args]`, `buncc sh -` (stdin). Positional args are $1.. as in sh. */
export async function shMain(args: string[]): Promise<number> {
  let script: string;
  let positional: string[] = [];
  if (args[0] === "-c") {
    script = args[1] ?? "";
    positional = args.slice(2);
  } else if (args[0] === "-" || args.length === 0) {
    script = await Bun.stdin.text();
  } else {
    script = readFileSync(args[0]!, "utf8");
    positional = args.slice(1);
  }
  script = script.replace(/^#!.*\r?\n/, "").replace(/\r\n/g, "\n");
  positional.forEach((value, i) => {
    script = script.replaceAll(new RegExp(`\\$\\{?${i + 1}\\}?`, "g"), () => shellQuote(value));
  });
  const result = await runScript(script, {});
  return result.code;
}

export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Bun Shell expands `$NAME` but not `${NAME}` (checked on Bun 1.4.4). Rewrite the braced form so bash-style scripts keep
 * their meaning: inside double quotes `"a${X}b"` becomes `"a""$X""b"`, elsewhere `${X}b` becomes `"$X"b`. Single-quoted text
 * and backslash-escaped `$` are left alone. Forms with operators (`${X:-d}`, `${#X}`, `${X%p}`) are not supported: they are
 * reported through `unsupported` and left as written.
 */
export function expandBraces(script: string): { script: string; unsupported: string[] } {
  const unsupported: string[] = [];
  let out = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < script.length; i++) {
    const c = script[i]!;
    if (c === "\\" && quote !== "'") {
      out += c + (script[i + 1] ?? "");
      i++;
      continue;
    }
    if (quote === "'") {
      if (c === "'") quote = null;
      out += c;
      continue;
    }
    if (c === "'" && quote === null) {
      quote = "'";
      out += c;
      continue;
    }
    if (c === '"') {
      quote = quote === '"' ? null : '"';
      out += c;
      continue;
    }
    if (c === "$" && script[i + 1] === "{") {
      const end = script.indexOf("}", i);
      const name = end > 0 ? script.slice(i + 2, end) : "";
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        out += quote === '"' ? `""$${name}""` : `"$${name}"`;
        i = end;
        continue;
      }
      unsupported.push(end > 0 ? script.slice(i, end + 1) : "${");
    }
    out += c;
  }
  return { script: out, unsupported };
}
