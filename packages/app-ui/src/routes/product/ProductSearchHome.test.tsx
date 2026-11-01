// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ProductSearchHome } from "./ProductSearchHome";
import { useI18n } from "../../i18n";
import { productSearchMessages } from "./product-search-messages";

test("homepage exposes a labelled native search and retains product resource destinations", () => {
  useI18n.getState().setLanguage("en");
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ProductSearchHome />
    </MemoryRouter>,
  );
  expect(html).toContain('<search aria-label="Aphrody web search"');
  expect(html).toContain('for="aphrody-home-search"');
  expect(html).toContain('type="search"');
  expect(html).toContain('aria-live="polite"');
  for (const href of ["/os", "/docs", "/templates", "/material-3/components", "https://downloads.aphrody.com/"]) {
    expect(html).toContain(`href="${href}"`);
  }
  expect(html).toContain("No account cookies");
  expect(html).not.toContain("60fps");
  expect(html).not.toContain("WebAssembly");
});

test("public search redacts failure, stays in Aphrody and retries the real backend", async () => {
  useI18n.getState().setLanguage("fr");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  // The decorative pet's continuous state updates prevent act() from settling.
  globalThis.requestAnimationFrame = () => 0;
  const requested: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    requested.push(String(url));
    return requested.length === 1
      ? Response.json({ error: "private backend diagnostics" }, { status: 503 })
      : Response.json({
          query: "TypeScript 7 & Bun",
          organic: [
            {
              title: "Bun documentation",
              url: "https://bun.sh/docs",
              snippet: "Runtime documentation",
            },
          ],
        });
  }) as typeof fetch;
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <ProductSearchHome publicPreview />
        </MemoryRouter>,
      ),
    );
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "TypeScript 7 & Bun");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(requested).toHaveLength(1);
    expect(requested[0]).toStartWith("/api/search?");
    const alert = host.querySelector('[role="alert"]')!;
    expect(new URL(requested[0], "https://aphrody.com").searchParams.get("hl")).toBe("fr");
    expect(alert.textContent).toContain(productSearchMessages.fr.unavailable);
    expect(alert.textContent).not.toContain("private backend diagnostics");
    const link = alert.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/docs");
    expect(host.querySelector('a[href*="google.com"]')).toBeNull();
    await act(async () => alert.querySelector("button")!.click());
    expect(requested).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("Résultats pour TypeScript 7 & Bun");
    expect(host.querySelector('a[href="https://bun.sh/docs"]')).not.toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
    await act(async () => root.unmount());
    host.remove();
  }
});

test("agent mode grounds its streamed answer in the public search results", async () => {
  useI18n.getState().setLanguage("en");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const domWindow = window as unknown as { happyDOM: { setURL: (url: string) => void } };
  const originalUrl = window.location.href;
  domWindow.happyDOM.setURL("https://aphrody.com/");
  globalThis.requestAnimationFrame = () => 0;
  const requests: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.startsWith("/api/search?"))
      return Response.json({
        query: "Wayland remote desktop",
        organic: [
          {
            title: "Wayland documentation",
            url: "https://wayland.freedesktop.org/",
            snippet: "Wayland is a protocol for a compositor to talk to its clients.",
          },
        ],
      });
    return new Response(
      'data: {"choices":[{"delta":{"content":"Wayland is a display protocol [1]."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <ProductSearchHome />
        </MemoryRouter>,
      ),
    );
    const agent = host.querySelector('[role="group"][aria-label="Search mode"] button:nth-child(2)')!;
    await act(async () => agent.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Wayland remote desktop");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toStartWith("/api/search?");
    expect(requests[1]!.url).toBe("https://aphrody.com/api/chat/v1/chat/completions");
    expect(requests[1]!.body).toContain("Wayland is a protocol");
    expect(host.textContent).toContain("Wayland is a display protocol [1].");
    expect(host.querySelector('a[href="https://wayland.freedesktop.org/"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
    domWindow.happyDOM.setURL(originalUrl);
    await act(async () => root.unmount());
    host.remove();
  }
});

test("every supported locale translates the complete public surface and preserves genuine routes", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const animationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    for (const language of ["fr", "en"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- locale updates share one mounted UI and must run in order.
      await act(async () => {
        useI18n.getState().setLanguage(language);
        root.render(
          <MemoryRouter>
            <ProductSearchHome />
          </MemoryRouter>,
        );
      });
      const html = host.innerHTML;
      const text = productSearchMessages[language];
      expect(html).toContain(`lang="${language}"`);
      expect(html).toContain(text.intro);
      expect(html).toContain(text.searchLabel);
      expect(html).toContain(text.privacy);
      expect(html).toContain(text.docs);
      expect(html).not.toContain('href="/studio?section=drive"');
      expect(Object.keys(text).toSorted()).toEqual(Object.keys(productSearchMessages.en).toSorted());
      expect(Object.values(text).every(value => value.trim().length > 0)).toBe(true);
      expect(html).not.toContain("Search images, news, videos and books");
    }
  } finally {
    await act(async () => root.unmount());
    globalThis.requestAnimationFrame = animationFrame;
  }
});
