// SPDX-License-Identifier: Apache-2.0
/**
 * `bun:graph-native` of the aphrody-labs/bun fork on upstream Bun. The fork ran the Rust graph
 * (`bun_graph::execute_json`) in a Worker through a `$newRustFunction` binding; here the same JSON
 * worker API lives in its Bun OS owner, crates/aphrody-code-graph (`api` module), and each request
 * runs in one `aphrody-graph exec` process: the request JSON on stdin, the response JSON on stdout.
 * At most four jobs run at once (excess jobs reject, as in the fork); aborting the signal kills the
 * process.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GraphRequest, GraphResponse } from "./types.ts";

export const MAX_JSON_BYTES = 512 * 1024 * 1024;
const MAX_JOBS = 4;
let running = 0;

const exe = process.platform === "win32" ? ".exe" : "";

/**
 * The `aphrody-graph` executable: `$APHRODY_GRAPH_BIN`, then a build of this checkout
 * (`target/{release,debug}`, also under `$CARGO_TARGET_DIR`), then `PATH`.
 */
export function graphBinary(): string {
  const configured = process.env.APHRODY_GRAPH_BIN;
  if (configured) {
    if (!existsSync(configured)) throw new Error(`APHRODY_GRAPH_BIN does not exist: ${configured}`);
    return configured;
  }
  const checkout = resolve(import.meta.dir, "..", "..", "..", "..");
  const targets = [process.env.CARGO_TARGET_DIR, join(checkout, "target")].filter(Boolean) as string[];
  for (const target of targets)
    for (const profile of ["release", "debug"]) {
      const candidate = join(target, profile, `aphrody-graph${exe}`);
      if (existsSync(candidate)) return candidate;
    }
  const found = Bun.which("aphrody-graph");
  if (found) return found;
  throw new Error(
    "aphrody-graph not found: build crates/aphrody-code-graph (cargo build -p aphrody-code-graph) or set APHRODY_GRAPH_BIN",
  );
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/** Runs Rust extraction and graph algorithms out of process. At most four jobs run; excess jobs reject. */
export async function executeGraph<R extends GraphRequest>(
  request: R,
  options: { signal?: AbortSignal } = {},
): Promise<GraphResponse<R>> {
  if (request === null || typeof request !== "object" || Array.isArray(request))
    throw new TypeError('The "request" argument must be of type object');
  if (options === null || typeof options !== "object")
    throw new TypeError('The "options" argument must be of type object');
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new TypeError('The "options.signal" property must be an instance of AbortSignal');
  if (signal?.aborted) throw abortReason(signal);
  const input = JSON.stringify(request);
  if (typeof input !== "string") throw new TypeError("request must encode as JSON");
  if (input.length > MAX_JSON_BYTES || Buffer.byteLength(input, "utf8") > MAX_JSON_BYTES)
    throw new RangeError(`request JSON bytes must be <= ${MAX_JSON_BYTES}`);
  if (running >= MAX_JOBS) throw new Error("Native graph capacity exceeded or job already registered");
  const binary = graphBinary();
  running++;
  try {
    await using proc = Bun.spawn([binary, "exec"], {
      stdin: new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
      signal,
      windowsHide: true,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (signal?.aborted) throw abortReason(signal);
    if (code !== 0) {
      const message = stderr.trim().replace(/^aphrody graph: /, "");
      if (/unrecognized subcommand 'exec'/.test(message))
        throw new Error(`${binary} predates the JSON worker API (aphrody-graph exec); rebuild aphrody-code-graph`);
      throw new Error(`Native graph: ${message || `aphrody-graph exited with ${code}`}`);
    }
    return JSON.parse(stdout) as GraphResponse<R>;
  } finally {
    running--;
  }
}

export default { executeGraph, graphBinary };
