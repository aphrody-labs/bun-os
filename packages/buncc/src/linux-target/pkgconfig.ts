/**
 * Small pkg-config implementation (.pc files) so a Windows host without pkgconf can still produce
 * `--cflags`/`--libs` for a sysroot. Follows the pkg-config guide: `${var}` expansion, `Requires`,
 * `Cflags`, `Libs`, `Libs.private` (static only) and `-I/-L` rewriting under a sysroot.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PcFile {
  name: string;
  vars: Map<string, string>;
  requires: string[];
  cflags: string;
  libs: string;
  libsPrivate: string;
  version: string;
}

function expand(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 16) return value;
  return value.replace(/\$\{([^}]+)\}/g, (_m, k: string) => (vars.has(k) ? expand(vars.get(k)!, vars, depth + 1) : ""));
}

export function parsePc(name: string, text: string): PcFile {
  const vars = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const v = /^([A-Za-z0-9_.]+)\s*=\s*(.*)$/.exec(line);
    if (v) {
      vars.set(v[1]!, v[2]!);
      continue;
    }
    const k = /^([A-Za-z0-9_.]+)\s*:\s*(.*)$/.exec(line);
    if (k) keys.set(k[1]!, k[2]!);
  }
  const get = (key: string) => expand(keys.get(key) ?? "", vars).trim();
  return {
    name,
    vars,
    requires: splitRequires(get("Requires")).concat(splitRequires(get("Requires.private"))),
    cflags: get("Cflags"),
    libs: get("Libs"),
    libsPrivate: get("Libs.private"),
    version: get("Version"),
  };
}

/** `a >= 1.0, b c` to module names. */
export function splitRequires(s: string): string[] {
  const out: string[] = [];
  const tokens = s.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    out.push(tokens[i]!);
    if (/^(>=|<=|=|<|>|!=)$/.test(tokens[i + 1] ?? "")) i += 2;
  }
  return out;
}

export interface PcResult {
  cflags: string[];
  libs: string[];
  modules: string[];
  missing: string[];
}

/** Resolves modules transitively. Every `-I`/`-L` path starting with `/` is prefixed with `sysroot`. */
export function pcFlags(modules: string[], dirs: string[], sysroot: string, opts: { static?: boolean } = {}): PcResult {
  const seen = new Map<string, PcFile>();
  const missing: string[] = [];
  const order: string[] = [];
  const visit = (m: string) => {
    if (seen.has(m)) return;
    const dir = dirs.find(d => existsSync(join(d, `${m}.pc`)));
    if (!dir) {
      missing.push(m);
      return;
    }
    const pc = parsePc(m, readFileSync(join(dir, `${m}.pc`), "utf8"));
    seen.set(m, pc);
    order.push(m);
    pc.requires.forEach(visit);
  };
  modules.forEach(visit);
  const fwd = sysroot.replace(/\\/g, "/").replace(/\/$/, "");
  const fix = (arg: string) => {
    const m = /^(-I|-L|-isystem)(\/.*)$/.exec(arg);
    return m ? `${m[1]}${fwd}${m[2]}` : arg;
  };
  const split = (s: string) => s.split(/\s+/).filter(Boolean).map(fix);
  const uniq = (xs: string[]) => {
    const out: string[] = [];
    for (const x of xs) if (!/^-[IL]/.test(x) || !out.includes(x)) out.push(x);
    return out;
  };
  const cflags: string[] = [];
  const libs: string[] = [];
  for (const m of order) {
    const pc = seen.get(m)!;
    cflags.push(...split(pc.cflags));
    libs.push(...split(pc.libs));
    if (opts.static) libs.push(...split(pc.libsPrivate));
  }
  return { cflags: uniq(cflags), libs: uniq(libs), modules: order, missing };
}
