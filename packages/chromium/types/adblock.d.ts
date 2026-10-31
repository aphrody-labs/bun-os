/** Brave's adblock-rust engine (MPL-2.0) built into Bun: network and cosmetic filtering. */
declare module "bun:adblock" {
  export interface EngineOptions {
    /** Filter list text, or one rule per element. */
    rules: string | readonly string[];
    /** `"standard"` (Adblock Plus / uBlock Origin syntax, default) or `"hosts"`. */
    format?: "standard" | "hosts";
    /** Keep the raw text of matched rules in `filter` / `exception`. Default `false`. */
    debug?: boolean;
    /** Redirect and scriptlet resources, in adblock-rust's resource JSON shape. */
    resources?: readonly Resource[];
  }

  export interface Resource {
    name: string;
    aliases?: string[];
    kind: { mime: string } | "template";
    /** Base64-encoded body. */
    content: string;
    dependencies?: string[];
    permission?: number;
  }

  export interface CheckResult {
    /** A blocking rule matched (it may be cancelled by an exception). */
    matched: boolean;
    /** The request must be blocked: `important`, or `matched` without an exception. */
    blocked: boolean;
    important: boolean;
    /** Matched blocking rule; the raw text only with `debug: true`. */
    filter?: string;
    /** Matched exception rule; the raw text only with `debug: true`. */
    exception?: string;
    /** `data:` URL of the redirect resource. */
    redirect?: string;
    /** The URL after `removeparam` rules. */
    rewrittenUrl?: string;
  }

  export interface CosmeticResources {
    hideSelectors: string[];
    proceduralActions: string[];
    /** Pass to `hiddenClassIdSelectors`. */
    exceptions: string[];
    injectedScript: string;
    generichide: boolean;
  }

  export type RequestType =
    | "document"
    | "subdocument"
    | "stylesheet"
    | "script"
    | "image"
    | "font"
    | "media"
    | "object"
    | "xmlhttprequest"
    | "websocket"
    | "ping"
    | "other"
    | (string & {});

  export class Engine {
    constructor(options: EngineOptions);
    /** Rebuilds an engine from `serialize()` output of the same Bun version. */
    static deserialize(bytes: ArrayBufferView | ArrayBuffer): Engine;
    /**
     * @param sourceUrl Page that issued the request; defaults to `url` (first-party).
     * @param requestType Defaults to `"other"`.
     * @param method Defaults to `"GET"`.
     */
    check(url: string, sourceUrl?: string, requestType?: RequestType, method?: string): CheckResult;
    urlCosmeticResources(url: string): CosmeticResources;
    hiddenClassIdSelectors(
      classes: readonly string[],
      ids: readonly string[],
      exceptions?: readonly string[],
    ): string[];
    serialize(): Uint8Array;
  }

  /**
   * Blocks matching requests of a Chrome-protocol `Bun.WebView` through the CDP `Fetch` domain.
   * Call after the first `navigate()`. Resolves to a function that detaches the engine.
   */
  export function attachWebView(view: Bun.WebView, engine: Engine): Promise<() => Promise<void>>;
}
