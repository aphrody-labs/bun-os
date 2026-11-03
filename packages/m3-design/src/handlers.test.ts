// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, mock, test } from "bun:test";
import { DesignCompiler } from "./generator.ts";
import { createFetchHandler } from "./handlers.ts";

const originalFetch = globalThis.fetch;
const handle = createFetchHandler(new DesignCompiler());
const finalizeBody = {
  projectId: "test-project",
  apiKey: "test-key",
  model: "test-model",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(path: string, body: unknown, signal?: AbortSignal): Request {
  return new Request(`http://design.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function replaceFetch(
  implementation: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>,
) {
  const replacement = mock(implementation);
  globalThis.fetch = Object.assign(replacement, {
    preconnect: originalFetch.preconnect,
  });
  return replacement;
}

describe("design HTTP routing", () => {
  test("GET / retains the engine details and endpoint descriptions", async () => {
    const response = await handle(new Request("http://design.test/"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.engine).toBe("design");
    expect(payload.status).toBe("active");
    expect(Object.keys(payload.endpoints)).toEqual(["POST /api/generate", "POST /api/generate/finalize"]);
  });

  test.each(["/api/unknown", "/api/generate/unknown", "/missing"])("unknown route %s returns 404", async path => {
    expect((await handle(new Request(`http://design.test${path}`))).status).toBe(404);
  });

  test.each([
    ["/", "POST", "GET"],
    ["/api/generate", "GET", "POST"],
    ["/api/generate/finalize", "PUT", "POST"],
  ])("route %s rejects %s and advertises %s", async (path, method, allowed) => {
    const response = await handle(new Request(`http://design.test${path}`, { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(allowed);
  });
});

describe("design generation request contract", () => {
  test("compiles a real brief with a HEX seed and design-system input", async () => {
    const response = await handle(
      request("/api/generate", {
        prompt: "A compact Android dashboard",
        seedColor: "#123",
        designSystemId: "material",
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.brief.platforms).toEqual(["android", "desktop-web"]);
    expect(result.brief.designSystemId).toBe("material");
    expect(result.theme.seed).toBe("#112233");
    expect(result.theme.themeExport.light.primary).toMatch(/^#[\da-f]{6}$/);
    expect(result.files.map((file: { path: string }) => file.path)).toEqual([
      "src/theme.css",
      "src/tokens.json",
      "src/index.tsx",
    ]);
  });

  test("malformed JSON is a client error", async () => {
    const response = await handle(
      new Request("http://design.test/api/generate", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
  });

  test.each([
    null,
    [],
    "brief",
    10,
    {},
    { prompt: null },
    { prompt: [] },
    { prompt: 12 },
    { prompt: false },
    { prompt: "" },
    { prompt: " \n\t" },
    { prompt: "A dashboard", seedColor: null },
    { prompt: "A dashboard", seedColor: {} },
    { prompt: "A dashboard", seedColor: 12 },
    { prompt: "A dashboard", seedColor: "" },
    { prompt: "A dashboard", seedColor: "red" },
    { prompt: "A dashboard", seedColor: "#12345" },
    { prompt: "A dashboard", seedColor: "#1234567" },
    { prompt: "A dashboard", designSystemId: null },
    { prompt: "A dashboard", designSystemId: [] },
    { prompt: "A dashboard", designSystemId: 12 },
  ])("invalid generate body %# returns 400", async body => {
    const response = await handle(request("/api/generate", body));
    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
  });

  test("compiler failures remain internal errors", async () => {
    const failing = createFetchHandler(
      new DesignCompiler({
        validateSpec() {
          throw new Error("validator unavailable");
        },
      }),
    );
    const response = await failing(request("/api/generate", { prompt: "A dashboard" }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("validator unavailable");
  });
});

describe("design finalization request contract", () => {
  test.each([
    null,
    [],
    "session",
    {},
    { ...finalizeBody, projectId: null },
    { ...finalizeBody, projectId: " \t" },
    { ...finalizeBody, apiKey: 1 },
    { ...finalizeBody, apiKey: "" },
    { ...finalizeBody, model: [] },
    { ...finalizeBody, model: " " },
    { ...finalizeBody, protocol: null },
    { ...finalizeBody, protocol: "unknown" },
    { ...finalizeBody, baseUrl: {} },
    { ...finalizeBody, baseUrl: "relative/url" },
    { ...finalizeBody, baseUrl: "file:///tmp/api" },
    { ...finalizeBody, baseUrl: "https://provider.invalid/api?key=x" },
    { ...finalizeBody, baseUrl: "https://provider.invalid/#section" },
    { ...finalizeBody, baseUrl: "https://user:password@provider.invalid" },
    { ...finalizeBody, transcriptJsonl: null },
    { ...finalizeBody, transcriptJsonl: [] },
    { ...finalizeBody, transcriptMessageCount: "2" },
    { ...finalizeBody, transcriptMessageCount: null },
    { ...finalizeBody, transcriptMessageCount: -1 },
    { ...finalizeBody, transcriptMessageCount: 1.5 },
    { ...finalizeBody, transcriptMessageCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...finalizeBody, designSystemId: {} },
    { ...finalizeBody, designSystemBody: 10 },
    { ...finalizeBody, artifact: [] },
    { ...finalizeBody, artifact: "source" },
    { ...finalizeBody, artifact: {} },
    { ...finalizeBody, artifact: { name: "", body: "source" } },
    { ...finalizeBody, artifact: { name: "index.tsx", body: false } },
  ])("invalid finalize body %# fails before provider access", async body => {
    const network = replaceFetch(async () => {
      throw new Error("unexpected network access");
    });
    expect((await handle(request("/api/generate/finalize", body))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });

  test("malformed finalize JSON fails before provider access", async () => {
    const network = replaceFetch(async () => {
      throw new Error("unexpected network access");
    });
    const response = await handle(
      new Request("http://design.test/api/generate/finalize", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });

  test.each([
    ["anthropic", { content: [{ type: "text", text: "# DESIGN.md" }] }],
    ["openai", { choices: [{ message: { content: "# DESIGN.md" } }] }],
    ["google", { candidates: [{ content: { parts: [{ text: "# DESIGN.md" }] } }] }],
  ])("%s preserves its provider payload and the request signal", async (protocol, reply) => {
    const controller = new AbortController();
    const req = request(
      "/api/generate/finalize",
      {
        ...finalizeBody,
        protocol,
        transcriptJsonl: '{"role":"user","content":"A dashboard"}',
        transcriptMessageCount: 1,
        designSystemId: "material",
        designSystemBody: "Design roles",
        artifact: { name: "index.tsx", body: "<main>Dashboard</main>" },
      },
      controller.signal,
    );
    const network = replaceFetch(async () => Response.json(reply));
    const response = await handle(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      designMd: "# DESIGN.md",
      projectId: "test-project",
      designSystemId: "material",
    });
    const [endpoint, init] = network.mock.calls[0]!;
    expect(init?.signal).toBe(req.signal);
    expect(init?.method).toBe("POST");
    const payload = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    if (protocol === "anthropic") {
      expect(String(endpoint)).toBe("https://api.anthropic.com/v1/messages");
      expect(headers.get("x-api-key")).toBe("test-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(payload.model).toBe("test-model");
      expect(payload.system).toContain("DESIGN.md");
      expect(payload.messages[0].content).toContain("<main>Dashboard</main>");
    } else if (protocol === "openai") {
      expect(String(endpoint)).toBe("https://api.openai.com/v1/chat/completions");
      expect(headers.get("authorization")).toBe("Bearer test-key");
      expect(payload.model).toBe("test-model");
      expect(payload.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
      expect(payload.messages[1].content).toContain("Transcript message count: 1");
    } else {
      expect(String(endpoint)).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent?key=test-key",
      );
      expect(payload.contents[0].parts[0].text).toContain("Design roles");
      expect(payload.systemInstruction.parts[0].text).toContain("DESIGN.md");
      expect(payload.generationConfig.maxOutputTokens).toBe(4000);
    }
  });

  test("default Anthropic and nullable optional synthesis inputs remain supported", async () => {
    const network = replaceFetch(async () => Response.json({ content: [{ type: "text", text: "Markdown" }] }));
    const response = await handle(
      request("/api/generate/finalize", {
        ...finalizeBody,
        designSystemId: null,
        designSystemBody: null,
        artifact: null,
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).designSystemId).toBeNull();
    const payload = JSON.parse(String(network.mock.calls[0]![1]?.body));
    expect(payload.messages[0].content).toContain("Transcript message count: 0");
    expect(payload.messages[0].content).toContain("Current artifact: none");
  });

  test("a custom versioned API URL keeps its path without duplicating v1", async () => {
    const network = replaceFetch(async () => Response.json({ choices: [{ message: { content: "Markdown" } }] }));
    const response = await handle(
      request("/api/generate/finalize", {
        ...finalizeBody,
        protocol: "openai",
        baseUrl: "http://provider.invalid/custom/v1/",
      }),
    );
    expect(response.status).toBe(200);
    expect(String(network.mock.calls[0]![0])).toBe("http://provider.invalid/custom/v1/chat/completions");
  });

  test("provider HTTP errors remain gateway errors with their response details", async () => {
    replaceFetch(async () => new Response("Provider unavailable", { status: 503 }));
    const response = await handle(request("/api/generate/finalize", finalizeBody));
    expect(response.status).toBe(502);
    expect((await response.json()).details).toBe("Provider unavailable");
  });

  test.each(["malformed-json", "missing-text", "blank-text", "transport"])(
    "provider %s failure returns 502",
    async failure => {
      replaceFetch(async () => {
        if (failure === "transport") throw new Error("fetch unavailable");
        if (failure === "blank-text") return Response.json({ content: [{ type: "text", text: " \n\t" }] });
        return failure === "malformed-json" ? new Response("{") : Response.json({});
      });
      expect((await handle(request("/api/generate/finalize", finalizeBody))).status).toBe(502);
    },
  );

  test("aborting the request interrupts the provider fetch", async () => {
    const controller = new AbortController();
    const req = request("/api/generate/finalize", finalizeBody, controller.signal);
    let started!: () => void;
    const providerStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    const network = replaceFetch(async (_endpoint, init) => {
      started();
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      });
    });
    const pending = handle(req);
    await providerStarted;
    controller.abort();
    expect((await pending).status).toBe(502);
    expect(network.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
});
