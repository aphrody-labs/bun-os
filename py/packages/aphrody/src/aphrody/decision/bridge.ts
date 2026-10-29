// SPDX-License-Identifier: Apache-2.0
/** Private product binding; the native host library is built from crates/aphrody-ffi and driven through @aphrody/runtime-sdk/python.
 * The caller supplies its qualified host/CPython environment and PYTHONPATH.
 * JSON is an explicit serialization boundary, never shared object memory.
 */
import type { PythonAsync } from "@aphrody/runtime-sdk/python";

export async function decideJson(python: PythonAsync, argument: string): Promise<string> {
  return await python.call("aphrody.decision.workflow", "decide_json", argument);
}

export interface NativeDecisionOptions {
  readonly runtime: { readonly directory: string; readonly manifestSha256: string };
  readonly bun: { readonly executable: string; readonly sha256: string; readonly revision: string };
  readonly provider?:
    | { readonly kind: "jev"; readonly baseURL?: string; readonly model?: string }
    | { readonly kind: "code"; readonly response: unknown };
}

const MAX_BYTES = 1024 * 1024;
function bounded(value: string): string {
  if (Buffer.byteLength(value, "utf8") > MAX_BYTES)
    throw Object.assign(new Error("Decision bridge payload exceeds its byte bound"), {
      code: "ERR_DECISION_INPUT_LIMIT",
    });
  return value;
}

/** Borrow one live CPython host. The Python application owns an SDK scope per call. */
export class BunDecisionBridge implements AsyncDisposable {
  readonly #python: Pick<PythonAsync, "call">;
  readonly #configuration: string;
  #pending: Promise<string> | undefined;
  #closed = false;

  constructor(python: Pick<PythonAsync, "call">, options: NativeDecisionOptions) {
    this.#python = python;
    this.#configuration = bounded(JSON.stringify(options));
  }

  async decideJson(argument: string): Promise<string> {
    if (this.#closed)
      throw Object.assign(new Error("Decision bridge is closed"), { code: "ERR_DECISION_CLOSED" });
    if (this.#pending)
      throw Object.assign(new Error("Decision bridge has an active call"), {
        code: "ERR_DECISION_BUSY",
      });
    const envelope = bounded(
      JSON.stringify({
        ...JSON.parse(this.#configuration),
        protocol: "aphrody.yolo.bun-bridge/1",
        argument: bounded(argument),
      }),
    );
    this.#pending = this.#python.call(
      "aphrody.decision.native_bridge",
      "decide_bun_json",
      envelope,
    );
    try {
      const result = await this.#pending;
      if (Buffer.byteLength(result, "utf8") > MAX_BYTES)
        throw Object.assign(new Error("Decision bridge result exceeds its byte bound"), {
          code: "ERR_DECISION_OUTPUT_LIMIT",
        });
      return result;
    } finally {
      this.#pending = undefined;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    // The operation reports its own error; disposal joins its native cleanup.
    await this.#pending?.catch(() => {});
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
