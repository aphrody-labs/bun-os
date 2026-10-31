#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Loopback Playwright adapter for the Obscura CDP service. Aphrody's Rust crawl
// runner owns recursion, policy, durable frontier, extraction, and indexing.
import { chromium, type Browser } from "playwright-core";

const cdpUrl = process.env["APHRODY_WEB_CDP_URL"] ?? "http://127.0.0.1:9222";
const bind = process.env["APHRODY_WEB_PLAYWRIGHT_BIND"] ?? "127.0.0.1:9230";
const maxConcurrent = 4;
const maxHtmlBytes = 4 * 1024 * 1024;
let browser: Browser | undefined;
let connecting: Promise<Browser> | undefined;
let active = 0;

function loopbackUrl(raw: string, label: string): URL {
  const url = new URL(raw);
  if (
    !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
    !["127.0.0.1", "::1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(`${label} must be an unauthenticated loopback URL`);
  return url;
}

const cdpEndpoint = loopbackUrl(cdpUrl, "APHRODY_WEB_CDP_URL");
const bindUrl = new URL(`http://${bind}`);
if (!["127.0.0.1", "::1", "localhost"].includes(bindUrl.hostname))
  throw new Error("APHRODY_WEB_PLAYWRIGHT_BIND must bind to loopback");
const port = Number(bindUrl.port || 9230);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("invalid Playwright bridge port");

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (connecting) return connecting;
  connecting = chromium
    .connectOverCDP(cdpEndpoint.href, { timeout: 10_000, noDefaults: true })
    .then((value) => {
      browser = value;
      browser.once("disconnected", () => {
        browser = undefined;
      });
      return value;
    })
    .finally(() => {
      connecting = undefined;
    });
  return connecting;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function allowedHost(host: string, domains: Set<string>): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return [...domains].some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

const server = Bun.serve({
  hostname: bindUrl.hostname,
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") {
      try {
        const connected = await getBrowser();
        return json({ ok: true, browser: connected.version() });
      } catch (error) {
        return json({ ok: false, error: String(error) }, 503);
      }
    }
    if (request.method !== "POST" || path !== "/render")
      return json({ error: "not found" }, 404);
    if (active >= maxConcurrent)
      return json({ error: "render capacity reached" }, 429);
    active++;
    try {
      const encodedBody = await request.text();
      if (new TextEncoder().encode(encodedBody).byteLength > 32 * 1024)
        return json({ error: "request too large" }, 413);
      const body = JSON.parse(encodedBody) as {
        url?: unknown;
        allowedDomains?: unknown;
        timeoutMs?: unknown;
        settleMs?: unknown;
      };
      if (typeof body.url !== "string" || body.url.length > 8192)
        return json(
          { error: "url must be a string of at most 8192 characters" },
          400,
        );
      const target = new URL(body.url);
      if (
        !["http:", "https:"].includes(target.protocol) ||
        target.username ||
        target.password
      )
        return json({ error: "url must be HTTP(S) without credentials" }, 400);
      if (
        !Array.isArray(body.allowedDomains) ||
        body.allowedDomains.length < 1 ||
        body.allowedDomains.length > 25 ||
        body.allowedDomains.some(
          (value) => typeof value !== "string" || value.length > 253,
        )
      )
        return json(
          { error: "allowedDomains must contain 1..25 hostnames" },
          400,
        );
      const domains = new Set(
        (body.allowedDomains as string[]).map((value) =>
          value.toLowerCase().replace(/\.$/, ""),
        ),
      );
      if (!allowedHost(target.hostname, domains))
        return json({ error: "target is outside crawl scope" }, 403);
      const timeoutMs =
        typeof body.timeoutMs === "number" ? body.timeoutMs : 30_000;
      const settleMs = typeof body.settleMs === "number" ? body.settleMs : 250;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
        return json({ error: "timeoutMs must be between 1 and 60000" }, 400);
      if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 5_000)
        return json({ error: "settleMs must be between 0 and 5000" }, 400);

      const connected = await getBrowser();
      const context = await connected.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      try {
        await context.route("**/*", async (route) => {
          let resource: URL;
          try {
            resource = new URL(route.request().url());
          } catch {
            await route.abort("blockedbyclient");
            return;
          }
          if (
            ["http:", "https:"].includes(resource.protocol) &&
            allowedHost(resource.hostname, domains)
          )
            await route.continue();
          else await route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        const response = await page.goto(target.href, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        if (settleMs) await page.waitForTimeout(settleMs);
        const html = await page.content();
        const size = new TextEncoder().encode(html).byteLength;
        if (size > maxHtmlBytes)
          return json(
            { error: `rendered HTML exceeds ${maxHtmlBytes} bytes` },
            413,
          );
        return json({
          url: page.url(),
          status: response?.status() ?? 200,
          contentType:
            response?.headers()["content-type"] ?? "text/html; charset=utf-8",
          html,
        });
      } finally {
        await context.close();
      }
    } catch (error) {
      return json({ error: String(error) }, 502);
    } finally {
      active--;
    }
  },
});

console.log(`Aphrody Playwright CDP bridge listening on ${server.url}`);
