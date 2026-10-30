#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bounded local capture: every showcase page in mobile, desktop and TV, with local assets.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { pool } from "../../../scripts/m3/build.ts";
import { PAGES } from "@aphrody/app-ui/material/pages/index.ts";
export type Layout = "mobile" | "desktop" | "tv";
export const VIEWPORTS: Record<Layout, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
  tv: { width: 1920, height: 1080 },
};
export interface Shot {
  route: string;
  layout: Layout;
  scheme: "light" | "dark";
  name: string;
}
export const shotName = (route: string, layout: Layout, scheme: "light" | "dark") => `${route}@${layout}-${scheme}`;
export function plan(
  routes: readonly string[],
  layouts: readonly Layout[] = ["mobile", "desktop", "tv"],
  schemes: readonly ("light" | "dark")[] = ["light"],
): Shot[] {
  for (const route of routes) if (!Object.hasOwn(PAGES, route)) throw new TypeError(`Unknown showcase route: ${route}`);
  for (const layout of layouts) if (!Object.hasOwn(VIEWPORTS, layout)) throw new TypeError(`Unknown layout: ${layout}`);
  for (const scheme of schemes)
    if (scheme !== "light" && scheme !== "dark") throw new TypeError(`Unknown scheme: ${scheme}`);
  return routes.flatMap(route =>
    layouts.flatMap(layout =>
      schemes.map(scheme => ({
        route,
        layout,
        scheme,
        name: shotName(route, layout, scheme),
      })),
    ),
  );
}
export const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--font-render-hinting=none",
  "--force-color-profile=srgb",
];
export interface CaptureResult {
  name: string;
  file: string;
  bytes: number;
  sha256: string;
  consoleErrors: string[];
}
export async function capture(
  baseUrl: string,
  outDir: string,
  shots: readonly Shot[],
  browser?: Browser,
): Promise<CaptureResult[]> {
  // Validate before creating output paths, including programmatic callers.
  for (const shot of shots) {
    const expected = plan([shot.route], [shot.layout], [shot.scheme])[0]!;
    if (shot.name !== expected.name) throw new TypeError("Invalid capture name");
  }
  await mkdir(outDir, { recursive: true });
  const own = !browser;
  const b = browser ?? (await chromium.launch({ headless: true, args: CHROMIUM_ARGS }));
  const origin = new URL(baseUrl).origin;
  try {
    return await pool(shots, 2, async shot => {
      const context = await b.newContext({
        viewport: VIEWPORTS[shot.layout],
        deviceScaleFactor: 1,
        colorScheme: shot.scheme,
        reducedMotion: "reduce",
        locale: "en-US",
        timezoneId: "UTC",
      });
      try {
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        await page.route("**/*", async route => {
          const url = new URL(route.request().url());
          if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) await route.continue();
          else {
            consoleErrors.push(`External asset: ${url.origin}`);
            await route.abort();
          }
        });
        page.on("console", message => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", error => consoleErrors.push(error.message));
        await page.goto(`${baseUrl}/?layout=${shot.layout}#/${shot.route}`, {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        const main = page.locator('[data-testid="main"]');
        await main.locator("h1").waitFor({ timeout: 20_000 });
        if ((await main.getAttribute("data-route")) !== shot.route)
          throw new Error(`Wrong destination for ${shot.route}`);
        if ((await page.locator('[data-testid="shell"]').getAttribute("data-layout")) !== shot.layout)
          throw new Error(`Wrong layout for ${shot.name}`);
        if ((await main.locator("h1").textContent())?.includes("Unable to load"))
          throw new Error(`Page failed: ${shot.route}`);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForTimeout(150);
        const file = join(outDir, `${shot.name}.png`);
        const png = await page.screenshot({
          path: file,
          animations: "disabled",
          caret: "hide",
          type: "png",
        });
        return {
          name: shot.name,
          file,
          bytes: png.length,
          sha256: new Bun.CryptoHasher("sha256").update(png).digest("hex"),
          consoleErrors,
        };
      } finally {
        await context.close();
      }
    });
  } finally {
    if (own) await b.close();
  }
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? undefined : args[i + 1];
  };
  const outArg = value("out");
  if (!outArg) throw new Error("Give --out pointing outside the repository");
  const results = await capture(
    value("url") ?? "http://127.0.0.1:3300",
    resolve(outArg),
    plan(
      value("routes")?.split(",") ?? Object.keys(PAGES),
      (value("layouts")?.split(",") ?? ["mobile", "desktop", "tv"]) as Layout[],
      (value("schemes")?.split(",") ?? ["light", "dark"]) as ("light" | "dark")[],
    ),
  );
  await Bun.write(join(resolve(outArg), "capture.json"), JSON.stringify(results, null, 2) + "\n");
  for (const result of results) console.log(`${result.name}: ${result.bytes} B, ${result.consoleErrors.length} errors`);
  if (results.some(result => result.consoleErrors.length > 0)) process.exitCode = 1;
}
