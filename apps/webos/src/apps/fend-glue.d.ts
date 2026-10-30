declare module "fend-wasm/fend_wasm_bg.js" {
  export function __wbg_set_wasm(exports: unknown): void;
  export function evaluateFendWithTimeout(input: string, timeout: number): string;
}
