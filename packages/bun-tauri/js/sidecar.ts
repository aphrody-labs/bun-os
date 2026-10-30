// SPDX-License-Identifier: Apache-2.0 OR MIT
// Build step for the `plugins > aphrody > bun > sidecar` mode: compiles the Bun server with the official
// `bun build --compile` into the `<name>-<target-triple>[.exe]` file Tauri's `bundle > externalBin` expects.
// Runs under upstream Bun only (`Bun.build` / `bun build --compile`), no fork API.

/** Rust target triple -> `bun build --compile --target` value (see Bun's "Single-file executable" docs). */
export const bunTargets = {
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-unknown-linux-musl": "bun-linux-x64-musl",
  "aarch64-unknown-linux-musl": "bun-linux-arm64-musl",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
} as const;

export type TauriTriple = keyof typeof bunTargets;

/** Host triple reported by `rustc -vV` (the one Tauri appends to `externalBin` names). */
export function hostTriple(): string {
  const out = Bun.spawnSync(["rustc", "-vV"]);
  if (!out.success) throw new Error("rustc -vV failed: " + out.stderr.toString());
  const host = /^host:\s*(\S+)/m.exec(out.stdout.toString())?.[1];
  if (!host) throw new Error("rustc -vV printed no host triple");
  return host;
}

export interface SidecarOptions {
  /** Server entry point, e.g. `server.ts` (the file that calls `serveForTauri`). */
  entry: string;
  /** `externalBin` entry without the triple, e.g. `binaries/server` (relative to `src-tauri`). */
  name: string;
  /** Directory `name` is relative to. Default: `src-tauri`. */
  tauriDir?: string;
  /** Rust target triple. Default: the host triple. */
  triple?: string;
  /** Extra `Bun.build` options (minify, bytecode, define, ...). */
  build?: Partial<Bun.BuildConfig>;
}

/** Compiles `entry` to `<tauriDir>/<name>-<triple>[.exe]` and returns the output path. */
export async function buildSidecar(options: SidecarOptions): Promise<string> {
  const triple = options.triple ?? hostTriple();
  const target = bunTargets[triple as TauriTriple];
  if (!target) throw new Error(`no Bun compile target for ${triple}; supported: ${Object.keys(bunTargets).join(", ")}`);
  const outfile = `${options.tauriDir ?? "src-tauri"}/${options.name}-${triple}`;
  const result = await Bun.build({
    ...options.build,
    entrypoints: [options.entry],
    compile: { target, outfile },
  } as Bun.BuildConfig);
  if (!result.success) throw new AggregateError(result.logs, `bun build --compile failed for ${options.entry}`);
  return result.outputs[0]?.path ?? outfile;
}
