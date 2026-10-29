/**
 * Shared helpers for the live production E2E suite (`bun test scripts/audit/live`).
 *
 * Pages are loaded through Aphrody Web (`@aphrody/bxc-test`, profile `static`):
 * the server-rendered DOM of a Next.js page is parsed by bxc's native CDP DOM
 * domain and queried with Playwright-shaped locators. No desktop browser is
 * ever started. Data that a page only fetches client-side is cross-checked
 * against the public API the page calls.
 *
 * Environment:
 *   LIVE_AUDIT_APHRODY       aphrody.com origin (default https://aphrody.com)
 *   BXC_RENDER_LIB           libbxc_render path; enables the JS diagnostics pass
 */

import { expect } from "bun:test";
import { collectPageDiagnostics, TestPage, type PageDiagnostics } from "@aphrody/bun-web/testing";

export { TestPage };

export const APHRODY = (process.env.LIVE_AUDIT_APHRODY ?? "https://aphrody.com").replace(/\/$/, "");

/** Per-test budgets (ms). */
export const T_PAGE = 60_000;
export const T_FLOW = 180_000;

/** Text that must never appear in a rendered page. */
export const ERROR_MARKERS = [
  "Application error: a server-side exception has occurred",
  "Application error: a client-side exception has occurred",
  "Unhandled Runtime Error",
  "Internal Server Error",
  "NEXT_NOT_FOUND",
  "This page could not be found",
];

const UA = "aphrody-live-audit/1.0 (+https://github.com/aphrody-labs/aphrody)";

/** Opens `url` in a fresh static page and asserts a < 400 document status. */
export async function open(url: string): Promise<TestPage> {
  const page = await TestPage.create({ profile: "static" });
  try {
    const response = await page.goto(url);
    expect(response.status, `document status of ${url}`).toBeLessThan(400);
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
}

/** Runs `body` with a page opened on `url`, always closing it. */
export async function withPage<T>(url: string, body: (page: TestPage) => Promise<T>): Promise<T> {
  const page = await open(url);
  try {
    return await body(page);
  } finally {
    await page.close();
  }
}

/** Server-rendered HTML with scripts, styles and the RSC payload stripped. */
export function visibleHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<template[\s\S]*?<\/template>/gi, "");
}

/** Plain text of an HTML fragment. */
export function textOf(html: string): string {
  return visibleHtml(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Page content HTML: `<body>` without scripts and styles. Scoping to `<main>`
 * is wrong for Next.js App Router pages: React streams Suspense content as
 * `<div hidden id="S:n">` chunks after the layout's `<main>` closes, so the
 * real data lives outside it in the SSR document.
 */
export async function mainHtml(page: TestPage): Promise<string> {
  const html = await page.content();
  return visibleHtml(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html);
}

/** Asserts the document carries no Next.js error boundary / 404 marker. */
export async function expectNoErrorMarkers(page: TestPage, label = page.url()): Promise<void> {
  const text = textOf(await page.content());
  for (const marker of ERROR_MARKERS) {
    expect(text.includes(marker), `« ${marker} » rendered on ${label}`).toBe(false);
  }
}

/** Distinct `href`s of `<a>` elements inside `html`, resolved against `base`. */
export function linksIn(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const [, href] of visibleHtml(html).matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    if (href === undefined) continue;
    const raw = href.replaceAll("&amp;", "&");
    if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) continue;
    try {
      const url = new URL(raw, base);
      url.hash = "";
      out.add(url.href);
    } catch {
      // malformed href — reported by the link check below as a failure
      out.add(`invalid:${raw}`);
    }
  }
  return [...out];
}

/** `src` of `<img>` elements inside `html` (ignores data: URIs). */
export function imagesIn(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const [, src] of visibleHtml(html).matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    if (src === undefined) continue;
    const raw = src.replaceAll("&amp;", "&");
    if (raw.startsWith("data:")) continue;
    try {
      out.add(new URL(raw, base).href);
    } catch {
      out.add(`invalid:${raw}`);
    }
  }
  return [...out];
}

const statusCache = new Map<string, Promise<number | string>>();

/** HTTP status of `url` (HEAD, falling back to GET), following redirects; memoized per run. */
export function statusOf(url: string): Promise<number | string> {
  let cached = statusCache.get(url);
  if (!cached) {
    cached = fetchStatus(url);
    statusCache.set(url, cached);
  }
  return cached;
}

async function fetchStatus(url: string, init: RequestInit = {}): Promise<number | string> {
  if (url.startsWith("invalid:")) return url;
  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
      ...init,
    });
    if ([403, 404, 405, 501].includes(response.status)) {
      response = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(30_000),
        ...init,
      });
      await response.arrayBuffer();
    }
    return response.status;
  } catch (error) {
    return `ERR ${String(error).slice(0, 120)}`;
  }
}

/** Checks every URL answers < 400 (bounded concurrency); returns the failures. */
export async function brokenUrls(urls: string[], concurrency = 8): Promise<string[]> {
  const queue = [...new Set(urls)];
  const broken: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const url = queue.shift() as string;
        const code = await statusOf(url);
        if (typeof code === "string" || code >= 400) broken.push(`${code} ${url}`);
      }
    }),
  );
  return broken.toSorted();
}

/** Fetches JSON; returns status, parsed body (or raw text) and headers. */
export async function getJson<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T; text: string; headers: Headers }> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: { "user-agent": UA, accept: "application/json", ...init.headers },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON body: kept as text for the assertion message
  }
  return {
    status: response.status,
    body: body as T,
    text,
    headers: response.headers,
  };
}

/** Engine limitations of libbxc_render that are not page defects. */
export const RENDER_ENGINE_NOISE = [/Expected document\.currentScript to be a <script> element/];

/** JS diagnostics through the native render profile (skips when unavailable). */
export function jsDiagnostics(url: string): Promise<PageDiagnostics> {
  return collectPageDiagnostics(url, {
    ignore: RENDER_ENGINE_NOISE,
    timeoutMs: 45_000,
  });
}

/** Short excerpt for assertion messages. */
export const excerpt = (value: unknown, size = 240) =>
  (typeof value === "string" ? value : JSON.stringify(value)).slice(0, size);
