// SPDX-License-Identifier: MIT
// libalpm version comparison (lib/libalpm/version.c: rpmvercmp + alpm_pkg_vercmp), ported to TypeScript.

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isAlpha = (c: string | undefined) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const isAlnum = (c: string | undefined) => isDigit(c) || isAlpha(c);

/** rpmvercmp: compare two version fragments (no epoch, no release). */
export function rpmvercmp(a: string, b: string): number {
  if (a === b) return 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start1 = i;
    const start2 = j;
    while (i < a.length && !isAlnum(a[i])) i++;
    while (j < b.length && !isAlnum(b[j])) j++;
    if (i >= a.length || j >= b.length) break;
    // Different separator runs: the longer one is newer.
    if (i - start1 !== j - start2) return i - start1 < j - start2 ? -1 : 1;
    let p1 = i;
    let p2 = j;
    const numeric = isDigit(a[p1]);
    if (numeric) {
      while (isDigit(a[p1])) p1++;
      while (isDigit(b[p2])) p2++;
    } else {
      while (isAlpha(a[p1])) p1++;
      while (isAlpha(b[p2])) p2++;
    }
    let s1 = a.slice(i, p1);
    let s2 = b.slice(j, p2);
    if (s2.length === 0) return numeric ? 1 : -1;
    if (numeric) {
      s1 = s1.replace(/^0+/, "");
      s2 = s2.replace(/^0+/, "");
      if (s1.length !== s2.length) return s1.length > s2.length ? 1 : -1;
    }
    if (s1 !== s2) return s1 < s2 ? -1 : 1;
    i = p1;
    j = p2;
  }
  const end1 = i >= a.length;
  const end2 = j >= b.length;
  if (end1 && end2) return 0;
  // Never let a remaining alpha tail beat an empty string.
  if ((end1 && !isAlpha(b[j])) || isAlpha(a[i])) return -1;
  return 1;
}

export interface EVR {
  epoch: string;
  version: string;
  release?: string;
}

export function parseEVR(full: string): EVR {
  let epoch = "0";
  let rest = full;
  const colon = rest.indexOf(":");
  if (colon > 0 && /^\d+$/.test(rest.slice(0, colon))) {
    epoch = rest.slice(0, colon);
    rest = rest.slice(colon + 1);
  }
  const dash = rest.lastIndexOf("-");
  if (dash >= 0) return { epoch, version: rest.slice(0, dash), release: rest.slice(dash + 1) };
  return { epoch, version: rest };
}

/** alpm_pkg_vercmp: epoch, then version, then release (only when both have one). */
export function vercmp(a: string, b: string): number {
  if (a === b) return 0;
  const x = parseEVR(a);
  const y = parseEVR(b);
  let r = rpmvercmp(x.epoch, y.epoch);
  if (r !== 0) return r;
  r = rpmvercmp(x.version, y.version);
  if (r !== 0) return r;
  if (x.release !== undefined && y.release !== undefined) return rpmvercmp(x.release, y.release);
  return 0;
}

export type DepOp = "=" | "<" | ">" | "<=" | ">=";

/** Does `version` satisfy `op constraint` (as pacman does for depends and provides)? */
export function satisfies(
  version: string,
  op: DepOp | "" | null | undefined,
  constraint: string | null | undefined,
): boolean {
  if (!op || !constraint) return true;
  const c = vercmp(version, constraint);
  switch (op) {
    case "=":
      return c === 0;
    case "<":
      return c < 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    case ">=":
      return c >= 0;
  }
}

export interface DepSpec {
  name: string;
  op: DepOp | "";
  version: string;
  /** optdepends only: text after ": ". */
  description: string;
}

/** "glibc>=2.40", "libfoo.so=1-64", "sh: shell" (optdepends). */
export function parseDep(raw: string): DepSpec {
  let text = raw.trim();
  let description = "";
  const colon = text.indexOf(": ");
  if (colon > 0) {
    description = text.slice(colon + 2).trim();
    text = text.slice(0, colon);
  }
  const m = /^([^<>=\s]+?)(?:(<=|>=|=|<|>)(.+))?$/.exec(text);
  if (!m) return { name: text, op: "", version: "", description };
  return { name: m[1]!, op: (m[2] as DepOp | undefined) ?? "", version: m[3] ?? "", description };
}
