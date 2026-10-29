/**
 * Arch Linux packaging: PKGBUILD generation and validation, `makepkg` invocation and `.pkg.tar.zst` naming.
 * Reference: https://wiki.archlinux.org/title/PKGBUILD and makepkg(8), PKGBUILD(5).
 */
import { run } from "../process.ts";
import { missing, probeVersion, which } from "./_shared.ts";
import type { Context, Provider } from "./types.ts";

export interface PkgbuildSpec {
  pkgname: string | string[];
  pkgver: string;
  pkgrel?: number | string;
  epoch?: number;
  pkgdesc: string;
  arch: string[];
  url?: string;
  license: string[];
  depends?: string[];
  makedepends?: string[];
  optdepends?: string[];
  provides?: string[];
  conflicts?: string[];
  options?: string[];
  source?: string[];
  /** One entry per source; use "SKIP" for VCS sources. */
  sha256sums?: string[];
  backup?: string[];
  /** Bash bodies of the functions. */
  prepare?: string;
  build?: string;
  check?: string;
  package: string;
  maintainer?: string;
}

/** Problems that make makepkg or namcap reject the file. Empty when valid. */
export function pkgbuildProblems(s: PkgbuildSpec): string[] {
  const p: string[] = [];
  const names = Array.isArray(s.pkgname) ? s.pkgname : [s.pkgname];
  for (const n of names)
    if (!/^[a-z0-9@_+][a-z0-9@._+-]*$/.test(n) || n.startsWith("-") || n.startsWith("."))
      p.push(`invalid pkgname "${n}" (lowercase letters, digits, @ . _ + -)`);
  if (/[-:/\s]/.test(s.pkgver) || !s.pkgver)
    p.push(`pkgver "${s.pkgver}" must not contain hyphens, colons, slashes or whitespace`);
  if (s.pkgrel !== undefined && !/^\d+(\.\d+)?$/.test(String(s.pkgrel)))
    p.push("pkgrel must be a positive integer (or n.m)");
  if (!s.arch.length) p.push("arch must list at least one architecture (or 'any')");
  if (s.arch.includes("any") && s.arch.length > 1) p.push("'any' cannot be combined with other architectures");
  if (!s.license.length) p.push("license must list at least one SPDX identifier");
  if (!s.pkgdesc || s.pkgdesc.length > 80) p.push("pkgdesc is required and should stay under 80 characters");
  if (s.sha256sums && s.source && s.sha256sums.length !== s.source.length)
    p.push("sha256sums must have one entry per source");
  if (s.source?.length && !s.sha256sums) p.push("sources need sha256sums (use SKIP for VCS sources)");
  for (const h of s.sha256sums ?? []) if (h !== "SKIP" && !/^[0-9a-f]{64}$/.test(h)) p.push(`bad sha256 "${h}"`);
  return p;
}

const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
const arr = (name: string, v?: string[]) => (v?.length ? `${name}=(${v.map(q).join(" ")})\n` : "");

/** Render a PKGBUILD. Throws when pkgbuildProblems is non-empty. */
export function generatePkgbuild(s: PkgbuildSpec): string {
  const problems = pkgbuildProblems(s);
  if (problems.length) throw new Error(`invalid PKGBUILD: ${problems.join("; ")}`);
  const names = Array.isArray(s.pkgname) ? s.pkgname : [s.pkgname];
  let out = s.maintainer ? `# Maintainer: ${s.maintainer}\n` : "";
  out += names.length > 1 ? arr("pkgname", names) : `pkgname=${q(names[0]!)}\n`;
  out += `pkgver=${s.pkgver}\npkgrel=${s.pkgrel ?? 1}\n`;
  if (s.epoch) out += `epoch=${s.epoch}\n`;
  out += `pkgdesc=${q(s.pkgdesc)}\n`;
  out += arr("arch", s.arch);
  if (s.url) out += `url=${q(s.url)}\n`;
  out += arr("license", s.license);
  out += arr("depends", s.depends) + arr("makedepends", s.makedepends) + arr("optdepends", s.optdepends);
  out +=
    arr("provides", s.provides) + arr("conflicts", s.conflicts) + arr("options", s.options) + arr("backup", s.backup);
  out += arr("source", s.source) + arr("sha256sums", s.sha256sums);
  const fn = (name: string, body?: string) =>
    body ? `\n${name}() {\n${body.replace(/^/gm, "  ").replace(/\s+$/, "")}\n}\n` : "";
  return out + fn("prepare", s.prepare) + fn("build", s.build) + fn("check", s.check) + fn("package", s.package);
}

/** `<name>-<epoch:>ver-rel-<arch>.pkg.tar.zst` as makepkg names it (PKGEXT default `.pkg.tar.zst`; the epoch is not in the file name). */
export function packageFileName(
  s: Pick<PkgbuildSpec, "pkgver" | "pkgrel" | "arch">,
  pkgname: string,
  arch: string,
  ext = ".pkg.tar.zst",
): string {
  return `${pkgname}-${s.pkgver}-${s.pkgrel ?? 1}-${s.arch.includes("any") ? "any" : arch}${ext}`;
}

export function makepkgArgs(
  o: {
    syncDeps?: boolean;
    force?: boolean;
    clean?: boolean;
    noCheck?: boolean;
    skipChecksums?: boolean;
    noConfirm?: boolean;
    noExtract?: boolean;
    install?: boolean;
  } = {},
): string[] {
  const args: string[] = [];
  if (o.syncDeps) args.push("--syncdeps");
  if (o.force) args.push("--force");
  if (o.clean) args.push("--cleanbuild", "--clean");
  if (o.noCheck) args.push("--nocheck");
  if (o.skipChecksums) args.push("--skipchecksums");
  if (o.noExtract) args.push("--noextract");
  if (o.noConfirm ?? true) args.push("--noconfirm");
  if (o.install) args.push("--install");
  return args;
}

export const srcinfoArgs = (): string[] => ["--printsrcinfo"];
export const namcapArgs = (file: string): string[] => [file];
export const updpkgsumsArgs = (): string[] => [];

export const makepkgProvider: Provider = {
  id: "makepkg",
  description: "makepkg, namcap and pacman for Arch Linux packages (.pkg.tar.zst)",
  platforms: ["linux"],
  async detect(ctx) {
    const makepkg = which("makepkg", ctx);
    if (!makepkg) return missing("sudo pacman -S --needed base-devel namcap   (Arch Linux, CachyOS, Omarchy)");
    const notes: string[] = [];
    if (!which("namcap", ctx)) notes.push("namcap missing: sudo pacman -S namcap");
    if (!which("zstd", ctx)) notes.push("zstd missing (needed for .pkg.tar.zst)");
    if (typeof process.getuid === "function" && process.getuid() === 0)
      notes.push("makepkg refuses to run as root; use a normal user");
    return {
      found: true,
      path: makepkg,
      version: await probeVersion(makepkg, ["--version"], ctx),
      notes: notes.length ? notes : undefined,
    };
  },
  install: () => ({ commands: [["sudo", "pacman", "-S", "--needed", "--noconfirm", "base-devel", "namcap"]] }),
  env: async () => ({ PKGEXT: ".pkg.tar.zst" }),
};

export async function buildPackage(ctx: Context, dir: string, o: Parameters<typeof makepkgArgs>[0] = {}) {
  const result = await run(["makepkg", ...makepkgArgs(o)], { cwd: dir, env: ctx.env, output: "inherit" });
  if (result.code !== 0) throw new Error(`makepkg exited with ${result.code}`);
}
