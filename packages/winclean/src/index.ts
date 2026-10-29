// SPDX-License-Identifier: Apache-2.0
/** Compatibility facade for the unified Aphrody OS kernel. */
import { KernelClient } from "@aphrody/os";
import { GeneratedTools, type ToolArgsMap, type ToolName } from "./generated";
import { TOOL_CATALOG } from "./catalog";
import { ToolResult } from "./result";
import { callBunWindows } from "./bun-windows";

export * from "./generated";
export * from "./result";
export { KernelError } from "@aphrody/os";

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Local kernel-backed WinClean client. */
export class Winclean extends GeneratedTools implements Disposable {
  readonly path: string;
  #clientPromise: Promise<KernelClient> | undefined;
  #closed = false;

  private constructor(readonly endpoint?: string) {
    super();
    this.path = endpoint ? "kernel://aphrody-os" : "windows-host+kernel://aphrody-os";
  }

  static open(endpoint?: string): Winclean {
    return new Winclean(endpoint);
  }

  get version(): string {
    return "kernel";
  }

  listTools(): ToolInfo[] {
    return TOOL_CATALOG.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  async call<N extends ToolName>(name: N, args?: ToolArgsMap[N]): Promise<ToolResult>;
  async call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  async call(name: string, args: object = {}): Promise<ToolResult> {
    if (this.#closed) throw new Error("Winclean client is closed");
    try {
      if (!this.endpoint) {
        const native = await callBunWindows(name, args as Record<string, unknown>);
        if (native.handled) {
          return new ToolResult(name, {
            structuredContent: native.value,
            content: [{ type: "text", text: JSON.stringify(native.value) }],
          });
        }
      }
      const client = await this.#client();
      const value = await client.call(name, args as Record<string, any>);
      return new ToolResult(name, {
        structuredContent: value,
        content: [{ type: "text", text: JSON.stringify(value) }],
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return new ToolResult(name, {
        isError: true,
        content: [{ type: "text", text }],
      });
    }
  }

  /** Synchronous calls are routed through the kernel RPC client. */
  callSync(_name: string, _args?: Record<string, unknown>): ToolResult {
    throw new Error("callSync is unavailable: use await Winclean.open().call(...) through the Aphrody OS kernel");
  }

  close(): void {
    this.#closed = true;
    void this.#clientPromise?.then(client => client.close());
  }

  [Symbol.dispose](): void {
    this.close();
  }

  async #client(): Promise<KernelClient> {
    return (this.#clientPromise ??= KernelClient.connect(this.endpoint, "bun/winclean"));
  }
}
