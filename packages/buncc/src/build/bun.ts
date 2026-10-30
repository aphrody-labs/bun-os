/** Argument builders for upstream `bun build`. Every flag below appears in `bun build --help` of the pinned canary. */

export const OS = ["linux", "darwin", "windows"] as const;
export const ARCH = ["x64", "arm64"] as const;

export interface CompileTarget {
  os: (typeof OS)[number];
  arch: (typeof ARCH)[number];
  musl: boolean;
  /** "-baseline" / "-modern" are accepted by Bun and resolve to the same x64 binary (docs/compiler/executables). */
  legacyCpuSuffix?: "baseline" | "modern";
}

/** Parse `bun-<os>-<arch>[-modern|-baseline][-musl]`; segments may come in any order (upstream executables.mdx). */
export function parseTarget(value: string): CompileTarget {
  const parts = value.split("-");
  if (parts[0] !== "bun") throw new Error(`Compile target must start with "bun-": ${value}`);
  const rest = parts.slice(1);
  const os = rest.find(part => (OS as readonly string[]).includes(part)) as CompileTarget["os"] | undefined;
  const arch = rest.find(part => (ARCH as readonly string[]).includes(part)) as CompileTarget["arch"] | undefined;
  if (!os || !arch) throw new Error(`Compile target needs an OS and an architecture: ${value}`);
  const musl = rest.includes("musl");
  const suffix = rest.find(part => part === "baseline" || part === "modern") as CompileTarget["legacyCpuSuffix"];
  const known = new Set<string>([os, arch, "musl", "baseline", "modern"]);
  const extra = rest.filter(part => !known.has(part));
  if (extra.length) throw new Error(`Unknown compile target segment(s) ${extra.join(", ")} in ${value}`);
  if (musl && os !== "linux") throw new Error(`musl is a Linux libc: ${value}`);
  return { os, arch, musl, legacyCpuSuffix: suffix };
}

/** Canonical form without the legacy CPU suffix, which Bun resolves to the same binary. */
export function canonicalTarget(target: CompileTarget): string {
  return ["bun", target.os, target.arch, target.musl ? "musl" : ""].filter(Boolean).join("-");
}

export interface BundleOptions {
  entry: string[];
  outdir?: string;
  target?: "bun" | "node" | "browser";
  minify?: boolean;
  splitting?: boolean;
  sourcemap?: "linked" | "inline" | "external" | "none";
  format?: "esm" | "cjs" | "iife";
  external?: string[];
}

export function bundleArgs(options: BundleOptions): string[] {
  const args = ["build", ...options.entry];
  if (options.outdir) args.push("--outdir", options.outdir);
  if (options.target) args.push(`--target=${options.target}`);
  if (options.format) args.push(`--format=${options.format}`);
  if (options.minify) args.push("--minify");
  if (options.splitting) args.push("--splitting");
  if (options.sourcemap) args.push(`--sourcemap=${options.sourcemap}`);
  for (const name of options.external ?? []) args.push(`--external=${name}`);
  return args;
}

export interface CompileOptions {
  entry: string;
  outfile: string;
  target?: string;
  aot?: boolean;
  /** Only valid with aot: let import()/require() read code from disk (makes the executable larger and slower). */
  aotAllowCodeFromDisk?: boolean;
  minify?: boolean;
  bytecode?: boolean;
  sourcemap?: "linked" | "inline" | "external" | "none";
  trim?: boolean;
  windows?: {
    hideConsole?: boolean;
    icon?: string;
    title?: string;
    publisher?: string;
    version?: string;
    description?: string;
    copyright?: string;
  };
}

/**
 * `bun build --compile [--aot]`. The long form is used on purpose: `bun compile` is an alias that a package.json script named
 * `compile` would shadow. Windows metadata flags only work on a Windows host; only --windows-hide-console works when cross-compiling.
 */
export function compileArgs(
  options: CompileOptions,
  hostOs: string = process.platform,
  hostArch: string = process.arch,
): string[] {
  const args = ["build", "--compile"];
  if (options.aot) args.push("--aot");
  if (options.aotAllowCodeFromDisk) {
    if (!options.aot) throw new Error("--aot-allow-code-from-disk requires --aot.");
    args.push("--aot-allow-code-from-disk");
  }
  let target: CompileTarget | undefined;
  if (options.target) {
    target = parseTarget(options.target);
    const hostTargetOs = hostOs === "win32" ? "windows" : hostOs;
    const hostTargetArch = hostArch === "arm64" ? "arm64" : "x64";
    if (options.aot && (target.os !== hostTargetOs || target.arch !== hostTargetArch))
      throw new Error(
        `bun build --compile --aot can't cross-compile: ${canonicalTarget(target)} differs from this host (${hostTargetOs}-${hostTargetArch}). Run the AOT build on the target platform, or drop --aot for a cross-compiled executable.`,
      );
    args.push(`--target=${canonicalTarget(target)}`);
  }
  if (options.minify) args.push("--minify");
  if (options.bytecode) args.push("--bytecode");
  if (options.trim) args.push("--trim");
  if (options.sourcemap) args.push(`--sourcemap=${options.sourcemap}`);
  const windows = options.windows;
  if (windows) {
    const targetsWindows = target ? target.os === "windows" : hostOs === "win32";
    if (!targetsWindows) throw new Error("Windows executable options need a Windows target.");
    const cross = target
      ? target.os !== (hostOs === "win32" ? "windows" : hostOs === "darwin" ? "darwin" : "linux")
      : false;
    const metadata =
      windows.icon || windows.title || windows.publisher || windows.version || windows.description || windows.copyright;
    if (metadata && (cross || hostOs !== "win32"))
      throw new Error(
        "--windows-icon/title/publisher/version/description/copyright need a Windows host; only --windows-hide-console works when cross-compiling.",
      );
    if (windows.hideConsole) args.push("--windows-hide-console");
    if (windows.icon) args.push(`--windows-icon=${windows.icon}`);
    if (windows.title) args.push(`--windows-title=${windows.title}`);
    if (windows.publisher) args.push(`--windows-publisher=${windows.publisher}`);
    if (windows.version) args.push(`--windows-version=${windows.version}`);
    if (windows.description) args.push(`--windows-description=${windows.description}`);
    if (windows.copyright) args.push(`--windows-copyright=${windows.copyright}`);
  }
  args.push(options.entry, "--outfile", options.outfile);
  return args;
}
