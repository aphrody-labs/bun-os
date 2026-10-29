import { canBuildFor, PINS, TRIPLES, versionOf, wasmOptCommand } from "./tools.ts";

export interface BunccWasmToolchain {
  cargo: boolean;
  targets: Record<string, boolean>;
  wasmBindgen: string | undefined;
  wasmOpt: string[];
  pins: typeof PINS;
}

/** What `buncc wasm` can do on this machine, for `buncc doctor`-style reports. */
export async function toolchain(): Promise<BunccWasmToolchain> {
  const targets: Record<string, boolean> = {};
  for (const triple of Object.values(TRIPLES)) targets[triple] = await canBuildFor(triple);
  const bindgen = Bun.which("wasm-bindgen");
  return {
    cargo: !!Bun.which("cargo"),
    targets,
    wasmBindgen: bindgen ? await versionOf(bindgen) : undefined,
    wasmOpt: wasmOptCommand(),
    pins: PINS,
  };
}
