import { copyFileSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { validate } from "./inspect.ts";
import { checked, wasmOptCommand, WASM_OPT_FEATURES } from "./tools.ts";

export type OptimizeLevel = "O" | "O0" | "O1" | "O2" | "O3" | "O4" | "Os" | "Oz";

export interface OptimizeOptions {
  /** Output file. Defaults to optimizing `input` in place. */
  output?: string;
  /** wasm-opt level. Defaults to `"Oz"`. */
  level?: OptimizeLevel;
  /** Keep debug info and the producers section. */
  debug?: boolean;
}

export interface OptimizeResult {
  before: number;
  after: number;
}

/**
 * Run wasm-opt (binaryen) on a core module. The result is validated, and an optimization that
 * makes the module larger is discarded so the output is never worse than the input.
 */
export async function optimize(input: string, options: OptimizeOptions = {}): Promise<OptimizeResult> {
  const output = options.output ?? input;
  const level = options.level ?? "Oz";
  if (!/^O[0-4sz]?$/.test(level)) throw new Error(`Unknown wasm-opt level -${level}`);
  const temp = `${output}.aphrody-opt-${process.pid}.wasm`;
  const flags = [`-${level}`, "--converge", ...WASM_OPT_FEATURES];
  if (options.debug !== true) flags.push("--strip-debug", "--strip-producers");
  try {
    await checked([...wasmOptCommand(), ...flags, input, "-o", temp]);
    const optimized = readFileSync(temp);
    if (!validate(optimized)) throw new Error("wasm-opt produced an invalid module");
    const before = statSync(input).size;
    if (optimized.byteLength <= before) {
      renameSync(temp, output);
    } else if (output !== input) {
      copyFileSync(input, output);
    }
    return { before, after: Math.min(before, optimized.byteLength) };
  } finally {
    rmSync(temp, { force: true });
  }
}
