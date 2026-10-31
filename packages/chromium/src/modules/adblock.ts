// SPDX-License-Identifier: MIT
// `bun:adblock` of the aphrody-labs/bun fork on upstream Bun: Brave adblock-rust (MPL-2.0), absorbed as
// crates/aphrody-adblock and reached through crates/aphrody-chromium-ffi with bun:ffi.
import type { Pointer } from "bun:ffi";
import type { CheckResult, CosmeticResources, EngineOptions, RequestType } from "bun:adblock";
import { ERR_INVALID_ARG_TYPE } from "../errors.ts";
import { errorCell, native, pointer, take, takeJSON, utf8 } from "../native.ts";

const finalizer = new FinalizationRegistry<Pointer>(handle => native().aphrody_adblock_free(handle));

function asBytes(value: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw ERR_INVALID_ARG_TYPE("bytes", ["Uint8Array", "ArrayBuffer"], value);
}

function json(value: unknown): Uint8Array {
  return utf8(JSON.stringify(value));
}

export class Engine {
  #handle: Pointer;

  constructor(options: EngineOptions);
  constructor(options: EngineOptions, handle?: Pointer);
  constructor(options: EngineOptions, handle?: Pointer) {
    if (handle) {
      this.#handle = handle;
    } else {
      if (!options || typeof options !== "object")
        throw ERR_INVALID_ARG_TYPE("options", 'an object with "rules"', options);
      if (typeof options.rules !== "string" && !Array.isArray(options.rules))
        throw ERR_INVALID_ARG_TYPE("rules", ["string", "string[]"], options.rules);
      const body = json(options);
      const error = errorCell();
      const created = native().aphrody_adblock_new(pointer(body), body.byteLength, error.pointer) as Pointer | null;
      error.check();
      if (!created) throw new Error("adblock: engine creation failed");
      this.#handle = created;
    }
    finalizer.register(this, this.#handle, this);
  }

  /** Rebuilds an engine from `serialize()` output of the same crate version. */
  static deserialize(bytes: ArrayBufferView | ArrayBuffer): Engine {
    const data = asBytes(bytes);
    const error = errorCell();
    const handle = native().aphrody_adblock_deserialize(
      pointer(data),
      data.byteLength,
      error.pointer,
    ) as Pointer | null;
    error.check();
    if (!handle) throw new Error("adblock: invalid serialized engine");
    return new Engine(undefined as unknown as EngineOptions, handle);
  }

  check(url: string, sourceUrl?: string, requestType?: RequestType, method?: string): CheckResult {
    if (typeof url !== "string") throw ERR_INVALID_ARG_TYPE("url", "string", url);
    const body = json({ url, sourceUrl, requestType, method });
    return takeJSON(native().aphrody_adblock_check(this.#handle, pointer(body), body.byteLength) as Pointer);
  }

  urlCosmeticResources(url: string): CosmeticResources {
    if (typeof url !== "string") throw ERR_INVALID_ARG_TYPE("url", "string", url);
    const body = utf8(url);
    return takeJSON(
      native().aphrody_adblock_url_cosmetic_resources(this.#handle, pointer(body), body.byteLength) as Pointer,
    );
  }

  hiddenClassIdSelectors(
    classes: readonly string[],
    ids: readonly string[],
    exceptions: readonly string[] = [],
  ): string[] {
    const body = json({ classes: classes ?? [], ids: ids ?? [], exceptions: exceptions ?? [] });
    return takeJSON(
      native().aphrody_adblock_hidden_class_id_selectors(this.#handle, pointer(body), body.byteLength) as Pointer,
    );
  }

  serialize(): Uint8Array {
    return take(native().aphrody_adblock_serialize(this.#handle) as Pointer);
  }
}

const resourceTypes: Record<string, string> = {
  Document: "document",
  Stylesheet: "stylesheet",
  Image: "image",
  Media: "media",
  Font: "font",
  Script: "script",
  XHR: "xmlhttprequest",
  Fetch: "xmlhttprequest",
  WebSocket: "websocket",
  Ping: "ping",
};

interface CdpView extends EventTarget {
  url: string;
  cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Chrome-protocol backends only: pauses every request through the Fetch domain and fails blocked
 * ones. Accepts `Bun.WebView` or any object with `cdp()` and `Fetch.requestPaused` events.
 */
export async function attachWebView(view: CdpView, engine: Engine): Promise<() => Promise<void>> {
  if (!(engine instanceof Engine)) throw ERR_INVALID_ARG_TYPE("engine", "Engine", engine);
  if (!view || typeof view.cdp !== "function" || typeof view.addEventListener !== "function")
    throw ERR_INVALID_ARG_TYPE("view", "Bun.WebView", view);
  const onPaused = (event: Event) => {
    const { requestId, request, resourceType } = (event as MessageEvent).data;
    let blocked = false;
    try {
      blocked = engine.check(
        request.url,
        view.url || request.url,
        resourceTypes[resourceType] ?? "other",
        request.method,
      ).blocked;
    } catch {}
    const reply = blocked
      ? view.cdp("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
      : view.cdp("Fetch.continueRequest", { requestId });
    reply.catch(() => {});
  };
  view.addEventListener("Fetch.requestPaused", onPaused);
  try {
    await view.cdp("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  } catch (error) {
    view.removeEventListener("Fetch.requestPaused", onPaused);
    throw error;
  }
  return async () => {
    view.removeEventListener("Fetch.requestPaused", onPaused);
    await view.cdp("Fetch.disable");
  };
}

export default { Engine, attachWebView };
