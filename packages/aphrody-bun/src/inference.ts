// SPDX-License-Identifier: Apache-2.0
import { CString, dlopen, FFIType, ptr, suffix, type Pointer } from "bun:ffi";
import { isAbsolute } from "node:path";
import { statePath } from "@aphrody/paths";
import packageMetadata from "../package.json";
import { verifyNativeArtifact } from "./native-artifact";

const symbols = {
  aphrody_inference_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_inference_submit: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.ptr,
  },
  aphrody_inference_poll: { args: [FFIType.u64], returns: FFIType.ptr },
  aphrody_inference_cancel: { args: [FFIType.u64], returns: FFIType.void },
  aphrody_inference_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

function openLibrary() {
  const filename = `${process.platform === "win32" ? "" : "lib"}aphrody_ffi.${suffix}`;
  const path = process.env.APHRODY_INFERENCE_LIBRARY ?? statePath("lib", filename);
  if (!isAbsolute(path)) throw new Error("APHRODY_INFERENCE_LIBRARY must be an absolute path");
  verifyNativeArtifact(path, packageMetadata.version);
  const opened = dlopen(path, symbols);
  if (opened.symbols.aphrody_inference_abi_version() !== 1) {
    opened.close();
    throw new Error("Aphrody inference ABI mismatch (expected 1)");
  }
  return opened;
}

// Process-owned: never unload a library while its native tasks or model destructors may run.
let shared: ReturnType<typeof openLibrary> | undefined;
function library() {
  return (shared ??= openLibrary());
}

function read(pointer: Pointer | bigint | null): Record<string, unknown> {
  if (!pointer) throw new Error("Native inference returned an empty buffer");
  const address = Number(pointer) as Pointer;
  if (!Number.isSafeInteger(address)) throw new Error("Native inference returned an unrepresentable pointer");
  try {
    const value: unknown = JSON.parse(new CString(address).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid native inference response");
    const result = value as Record<string, unknown>;
    if (typeof result.error === "string") throw new Error(result.error);
    return result;
  } finally {
    library().symbols.aphrody_inference_free(address);
  }
}

async function request(value: Record<string, unknown>, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  options.signal?.throwIfAborted();
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > 1024 * 1024) throw new Error("Native inference request exceeds 1 MiB");
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError("timeoutMs must be positive and finite");
  const native = library().symbols;
  const started = read(native.aphrody_inference_submit(ptr(bytes), bytes.length));
  if (!Number.isSafeInteger(started.job) || Number(started.job) <= 0)
    throw new Error("Native inference returned an invalid job id");
  const job = BigInt(started.job as number);
  const deadline = performance.now() + timeout;
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      if (performance.now() >= deadline) throw new DOMException("Native inference deadline exceeded", "TimeoutError");
      const result = read(native.aphrody_inference_poll(job));
      if (result.pending !== true) return result;
      // oxlint-disable-next-line no-await-in-loop -- poll native work without blocking Bun heartbeats
      await Bun.sleep(10);
    }
  } finally {
    native.aphrody_inference_cancel(job);
  }
}

export interface NativeInferenceOptions {
  /** Catalog id or already-installed pinned model reference. Never downloads implicitly. */
  model: string;
  profile: string;
  context?: number;
  gpuLayers?: number;
  /** Existing compatible GGUF LoRA adapter, distinct from the Agent Home SOUL. */
  lora?: string;
}
export interface NativeChatInput {
  messages: readonly { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface NativeChatResult {
  text: string;
  model: string;
  profile: string;
  usage: { input: number; output: number; total: number } | null;
  finishReason: string | null;
}

export class NativeInference implements AsyncDisposable {
  #session: number;
  #closing: Promise<void> | undefined;
  #pending = new Set<Promise<unknown>>();
  private constructor(
    session: number,
    readonly model: string,
    readonly profile: string,
  ) {
    this.#session = session;
  }

  static async open(options: NativeInferenceOptions, controls: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    if (!options.model.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.profile))
      throw new Error("A model and explicit Agent Home profile are required");
    const result = await request(
      {
        operation: "open",
        model: options.model,
        profile: options.profile,
        context: options.context,
        gpu_layers: options.gpuLayers,
        lora: options.lora,
      },
      controls,
    );
    if (
      !Number.isSafeInteger(result.session) ||
      result.model !== options.model ||
      result.profile !== options.profile ||
      result.backend !== "in-process"
    )
      throw new Error("Invalid native model identity");
    return new NativeInference(result.session as number, options.model, options.profile);
  }

  async chat(input: NativeChatInput): Promise<NativeChatResult> {
    if (this.#closing) throw new Error("Native model session is closing");
    const pending = request(
      {
        operation: "chat",
        session: this.#session,
        system: input.system,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        messages: input.messages.map(message => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      },
      input,
    );
    this.#pending.add(pending);
    let result: Record<string, unknown>;
    try {
      result = await pending;
    } finally {
      this.#pending.delete(pending);
    }
    if (
      typeof result.text !== "string" ||
      !result.text.trim() ||
      result.model !== this.model ||
      result.profile !== this.profile
    )
      throw new Error("Invalid native chat response");
    const raw = result.usage;
    let usage: NativeChatResult["usage"] = null;
    if (raw !== null && raw !== undefined) {
      const tokens = raw as Record<string, unknown>;
      if (![tokens.input, tokens.output, tokens.total].every(n => Number.isSafeInteger(n) && Number(n) >= 0))
        throw new Error("Invalid native token accounting");
      usage = {
        input: Number(tokens.input),
        output: Number(tokens.output),
        total: Number(tokens.total),
      };
    }
    return {
      text: result.text,
      model: this.model,
      profile: this.profile,
      usage,
      finishReason: typeof result.finish_reason === "string" ? result.finish_reason : null,
    };
  }

  close(): Promise<void> {
    return (this.#closing ??= Promise.allSettled(this.#pending).then(async () => {
      await request({ operation: "close", session: this.#session });
      return undefined;
    }));
  }
  [Symbol.asyncDispose]() {
    return this.close();
  }
}
