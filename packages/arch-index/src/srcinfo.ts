// SPDX-License-Identifier: MIT
// .SRCINFO parser written against the documented format (man 5 SRCINFO, archlinux/pacman/doc/SRCINFO.5.asciidoc):
// a "pkgbase = name" section followed by "pkgname = name" sections; "key = value" lines, indented by a tab;
// arrays repeat the key; architecture specific keys carry an "_<arch>" suffix.
// Comments (#) and blank lines are ignored. Evaluated values only: .SRCINFO never contains shell.

export type SrcinfoSection = Record<string, string[]>;

export interface Srcinfo {
  pkgbase: string;
  /** Keys of the pkgbase section, every key an array in file order. */
  base: SrcinfoSection;
  packages: { pkgname: string; fields: SrcinfoSection }[];
  epoch: string;
  pkgver: string;
  pkgrel: string;
  /** epoch:pkgver-pkgrel, epoch omitted when 0 or unset. */
  version: string;
  sources: SrcinfoSource[];
}

export interface SrcinfoSource {
  /** Raw source entry, optionally "filename::url". */
  source: string;
  /** "" for architecture independent. */
  arch: string;
  /** Checksums by algorithm (sha256, b2, md5, ...); "SKIP" for unchecked sources. */
  checksums: Record<string, string>;
}

const CHECKSUM_KEYS = ["md5", "sha1", "sha224", "sha256", "sha384", "sha512", "b2", "ck"] as const;

export function parseSrcinfo(text: string): Srcinfo {
  let base: SrcinfoSection | undefined;
  let pkgbase = "";
  const packages: { pkgname: string; fields: SrcinfoSection }[] = [];
  let current: SrcinfoSection | undefined;
  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) throw new Error(`Malformed .SRCINFO line ${lineNo}: "${line.slice(0, 60)}"`);
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "pkgbase") {
      if (base) throw new Error(`Malformed .SRCINFO line ${lineNo}: second pkgbase section.`);
      pkgbase = value;
      base = {};
      current = base;
      continue;
    }
    if (key === "pkgname") {
      if (!base) throw new Error(`Malformed .SRCINFO line ${lineNo}: pkgname before pkgbase.`);
      const fields: SrcinfoSection = {};
      packages.push({ pkgname: value, fields });
      current = fields;
      continue;
    }
    if (!current) throw new Error(`Malformed .SRCINFO line ${lineNo}: key before pkgbase.`);
    (current[key] ??= []).push(value);
  }
  if (!base) throw new Error("Malformed .SRCINFO: no pkgbase section.");
  if (packages.length === 0) throw new Error("Malformed .SRCINFO: no pkgname section.");
  const one = (k: string) => base![k]?.[0] ?? "";
  const epoch = one("epoch");
  const pkgver = one("pkgver");
  const pkgrel = one("pkgrel");
  if (!pkgver) throw new Error("Malformed .SRCINFO: pkgver missing.");
  return {
    pkgbase,
    base,
    packages,
    epoch,
    pkgver,
    pkgrel,
    version: `${epoch && epoch !== "0" ? `${epoch}:` : ""}${pkgver}${pkgrel ? `-${pkgrel}` : ""}`,
    sources: zipSources(base),
  };
}

function zipSources(base: SrcinfoSection): SrcinfoSource[] {
  const out: SrcinfoSource[] = [];
  for (const key of Object.keys(base)) {
    const m = /^source(?:_(.+))?$/.exec(key);
    if (!m) continue;
    const arch = m[1] ?? "";
    base[key]!.forEach((source, index) => {
      const checksums: Record<string, string> = {};
      for (const algo of CHECKSUM_KEYS) {
        const sums = base[`${algo}sums${arch ? `_${arch}` : ""}`];
        if (sums?.[index] !== undefined) checksums[algo] = sums[index]!;
      }
      out.push({ source, arch, checksums });
    });
  }
  return out;
}

/** Split "name::url" into its parts; plain entries use the URL basename as file name. */
export function sourceParts(source: string): { file: string; url: string } {
  const sep = source.indexOf("::");
  if (sep > 0) return { file: source.slice(0, sep), url: source.slice(sep + 2) };
  const clean = source.split(/[?#]/)[0]!;
  return { file: clean.slice(clean.lastIndexOf("/") + 1), url: source };
}

/** Collapse one package's effective field: package overrides pkgbase (makepkg semantics). */
export function effective(info: Srcinfo, pkgname: string, key: string): string[] {
  const pkg = info.packages.find(p => p.pkgname === pkgname);
  return pkg?.fields[key] ?? info.base[key] ?? [];
}
