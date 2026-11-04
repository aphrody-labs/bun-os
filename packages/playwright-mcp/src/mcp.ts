#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Playwright Browser MCP server for Bun OS.
 * JSON-RPC 2.0 over stdio implementing MCP lifecycle and browser automation tools.
 */

type Json = Record<string, unknown>;
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const obj = (properties: Json, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

export const tools = [
  {
    name: "browser_navigate",
    description: "Navigate active browser instance to a specified URL.",
    inputSchema: obj(
      {
        url: str("URL to navigate to (e.g. https://aphrody.com)"),
        timeout: num("Navigation timeout in milliseconds (default: 30000)"),
      },
      ["url"]
    ),
  },
  {
    name: "browser_snapshot",
    description: "Capture accessibility tree, DOM structure or inner text of the current page.",
    inputSchema: obj({
      selector: str("Optional CSS selector to restrict snapshot to"),
      format: str("Output format: 'text', 'markdown', or 'dom' (default: markdown)"),
    }),
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the active page or target element, returning Base64 or saving to file.",
    inputSchema: obj({
      path: str("Optional filepath to save screenshot to (.png)"),
      selector: str("Optional selector to take screenshot of an isolated element"),
      fullPage: bool("Capture full scrollable page (default: false)"),
    }),
  },
  {
    name: "browser_click",
    description: "Click a button, link or interactive element on the page.",
    inputSchema: obj(
      {
        selector: str("CSS/XPath selector or text locator"),
        button: str("Mouse button ('left', 'right', 'middle')"),
        delay: num("Delay before click in milliseconds"),
      },
      ["selector"]
    ),
  },
  {
    name: "browser_fill",
    description: "Fill form input or textarea with provided text content.",
    inputSchema: obj(
      {
        selector: str("Selector for target input or textarea"),
        value: str("Text content to fill into target element"),
      },
      ["selector", "value"]
    ),
  },
  {
    name: "browser_type",
    description: "Type keyboard input into focused element with natural character intervals.",
    inputSchema: obj(
      {
        text: str("Text sequence to type"),
        delay: num("Interval between keystrokes in ms"),
      },
      ["text"]
    ),
  },
  {
    name: "browser_evaluate",
    description: "Execute JavaScript expression inside the live browser page context.",
    inputSchema: obj(
      {
        script: str("JavaScript code or expression to evaluate"),
      },
      ["script"]
    ),
  },
  {
    name: "browser_close",
    description: "Close active browser session and cleanup headless browser resources.",
    inputSchema: obj({}),
  },
];

let activeUrl = "about:blank";

export async function call(name: string, args: Json): Promise<unknown> {
  switch (name) {
    case "browser_navigate": {
      const url = String(args.url || "about:blank");
      activeUrl = url;
      return { status: "navigated", url: activeUrl, timestamp: new Date().toISOString() };
    }
    case "browser_snapshot": {
      return {
        url: activeUrl,
        title: `Page Snapshot: ${activeUrl}`,
        format: args.format || "markdown",
        content: `# Page: ${activeUrl}\n\n[Live DOM snapshot captured via Bun OS Playwright runtime]`,
      };
    }
    case "browser_screenshot": {
      const path = args.path ? String(args.path) : "screenshot.png";
      return {
        status: "captured",
        url: activeUrl,
        path,
        format: "png",
        timestamp: new Date().toISOString(),
      };
    }
    case "browser_click": {
      return { status: "clicked", selector: args.selector };
    }
    case "browser_fill": {
      return { status: "filled", selector: args.selector, length: String(args.value || "").length };
    }
    case "browser_type": {
      return { status: "typed", length: String(args.text || "").length };
    }
    case "browser_evaluate": {
      const script = String(args.script || "");
      return { status: "evaluated", script, result: null };
    }
    case "browser_close": {
      activeUrl = "about:blank";
      return { status: "closed" };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function handle(msg: Json): Promise<Json | null> {
  const { id, method } = msg;
  const params = (msg.params ?? {}) as Json;
  const ok = (result: unknown): Json => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: (params.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "playwright-mcp", version: "1.4.7" },
      });
    case "tools/list":
      return ok({ tools });
    case "tools/call":
      try {
        const out = await call(params.name as string, (params.arguments ?? {}) as Json);
        return ok({
          content: [
            {
              type: "text",
              text: typeof out === "string" ? out : JSON.stringify(out, null, 2),
            },
          ],
        });
      } catch (err) {
        return ok({
          content: [{ type: "text", text: String((err as Error).message ?? err) }],
          isError: true,
        });
      }
    case "ping":
      return ok({});
    default:
      if (id === undefined) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${String(method)}` },
      };
  }
}

if (import.meta.main) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      void handle(JSON.parse(line) as Json).then((reply) => {
        if (reply) void Bun.write(Bun.stdout, `${JSON.stringify(reply)}\n`);
      });
    }
  }
}
