#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Chromium interaction checks against an existing local production server; no snapshots or installations.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { PAGES } from "@aphrody/app-ui/material/pages/index.ts";
import { CHROMIUM_ARGS } from "./shots.ts";

const RUNS = fileURLToPath(
  new URL("../../../../.coord/runs/m3-prod/", import.meta.url),
);
interface Check {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}
export interface BrowserContractReport {
  url: string;
  timestamp: string;
  browser: string;
  checks: Check[];
  navigation: { route: string; tag: string; href: string | null }[];
  inputUndefined?: { type: string; attribute: string | null };
  consoleErrors: string[];
  httpFailures: string[];
  externalRequests: string[];
}

/** Artifacts are restricted to the integrating agent's existing qualification directory. */
export function outputPath(
  value = resolve(RUNS, "browser-contract.json"),
): string {
  const target = resolve(value);
  const within = relative(RUNS, target);
  if (
    !within ||
    within === ".." ||
    within.startsWith(".." + sep) ||
    isAbsolute(within) ||
    !target.endsWith(".json")
  )
    throw new TypeError("Output must be a JSON file under " + RUNS);
  return target;
}
function localUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new TypeError("Use a local HTTP server URL.");
  return url.origin;
}
async function ready(page: Page, route: string): Promise<void> {
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('[data-testid="main"]')
        ?.getAttribute("data-route") === id,
    route,
  );
  await page.locator("main h1").waitFor();
  assert.equal(
    await page.locator("h1").count(),
    1,
    "Each page must have one document heading",
  );
  assert.doesNotMatch(
    await page.locator("main h1").innerText(),
    /Unable to load/i,
  );
}
async function destination(page: Page, route: string): Promise<void> {
  await page.getByTestId("nav-" + route).click();
  await ready(page, route);
  assert.equal(new URL(page.url()).hash, "#/" + route);
}
async function containsText(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  await page.waitForFunction(
    ({ selector: query, text: expectedText }) =>
      document.querySelector(query)?.textContent?.includes(expectedText),
    { selector, text },
  );
}
async function scheme(page: Page, expected: "light" | "dark"): Promise<void> {
  await page.waitForFunction(
    (value) => getComputedStyle(document.documentElement).colorScheme === value,
    expected,
  );
}
async function layout(page: Page, expected: string): Promise<void> {
  await page.waitForFunction(
    (value) =>
      document
        .querySelector('[data-testid="shell"]')
        ?.getAttribute("data-layout") === value,
    expected,
  );
}

export async function browserContract(
  baseUrl: string,
): Promise<BrowserContractReport> {
  const url = localUrl(baseUrl);
  const browser = await chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
  });
  const report: BrowserContractReport = {
    url,
    timestamp: new Date().toISOString(),
    browser: browser.version(),
    checks: [],
    navigation: [],
    consoleErrors: [],
    httpFailures: [],
    externalRequests: [],
  };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(20_000);
  async function check(
    name: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const start = performance.now();
    try {
      await action();
      report.checks.push({
        name,
        passed: true,
        durationMs: Math.round(performance.now() - start),
      });
      console.log("PASS " + name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.checks.push({
        name,
        passed: false,
        durationMs: Math.round(performance.now() - start),
        error: message.slice(0, 4000),
      });
      console.error("FAIL " + name + ": " + message.split("\n")[0]);
    }
  }
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.httpFailures.push(response.status() + " " + response.url());
  });
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.origin === url ||
      ["data:", "blob:"].includes(requestUrl.protocol)
    )
      await route.continue();
    else {
      report.externalRequests.push(requestUrl.origin);
      await route.abort();
    }
  });
  try {
    await page.goto(url + "/#/overview", { waitUntil: "networkidle" });
    await ready(page, "overview");
    await check("Chromium input type fallback", async () => {
      report.inputUndefined = await page.evaluate(() => {
        const input = document.createElement("input");
        input.type = undefined as unknown as string;
        return { type: input.type, attribute: input.getAttribute("type") };
      });
      assert.deepEqual(report.inputUndefined, {
        type: "text",
        attribute: "undefined",
      });
    });
    for (const route of Object.keys(PAGES)) {
      // eslint-disable-next-line no-await-in-loop -- Navigation runs sequentially in one real browser history.
      await check("Navigate and announce " + route, async () => {
        const control = page.getByTestId("nav-" + route);
        report.navigation.push({
          route,
          tag: await control.evaluate((element) => element.tagName),
          href: await control.getAttribute("href"),
        });
        await destination(page, route);
        assert.equal(await control.getAttribute("aria-current"), "page");
        if (route !== "overview")
          assert.match(await page.title(), new RegExp(route, "i"));
      });
    }
    await check("Destinations expose native deep links", async () => {
      assert.equal(report.navigation.length, 15);
      for (const control of report.navigation) {
        assert.equal(
          control.tag,
          "A",
          control.route + " must be a navigation link",
        );
        assert.equal(control.href, "#/" + control.route);
      }
    });
    await check(
      "Skip link focuses content and preserves the route",
      async () => {
        const before = page.url();
        await page
          .getByRole("link", { name: "Skip to content", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        assert.equal(page.url(), before);
        assert.equal(
          await page.evaluate(() => document.activeElement?.id),
          "main",
        );
      },
    );
    await check("Light and dark choices persist across reload", async () => {
      await destination(page, "theme");
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: "networkidle" });
      await ready(page, "theme");
      await page
        .getByRole("combobox", { name: "Colour mode", exact: true })
        .selectOption("dark");
      await scheme(page, "dark");
      await page.reload({ waitUntil: "networkidle" });
      await ready(page, "theme");
      await scheme(page, "dark");
      assert.equal(
        await page
          .getByRole("combobox", { name: "Colour mode", exact: true })
          .inputValue(),
        "dark",
      );
      await page
        .getByRole("combobox", { name: "Colour mode", exact: true })
        .selectOption("light");
      await scheme(page, "light");
      await page.reload({ waitUntil: "networkidle" });
      await ready(page, "theme");
      await scheme(page, "light");
      assert.equal(
        await page
          .getByRole("combobox", { name: "Colour mode", exact: true })
          .inputValue(),
        "light",
      );
    });
    await check(
      "Live layout overrides persist and auto follows the viewport",
      async () => {
        await destination(page, "adaptive");
        await page.getByTestId("layout-mobile").click();
        await layout(page, "mobile");
        assert.equal(await page.getByTestId("bottom-bar").count(), 1);
        await page.getByTestId("layout-tv").click();
        await layout(page, "tv");
        await page.reload({ waitUntil: "networkidle" });
        await ready(page, "adaptive");
        await layout(page, "tv");
        assert.equal(await page.getByTestId("drawer").count(), 1);
        await page.getByTestId("layout-auto").click();
        await layout(page, "desktop");
        await page.setViewportSize({ width: 390, height: 844 });
        await layout(page, "mobile");
        await page.setViewportSize({ width: 1280, height: 800 });
        await layout(page, "desktop");
      },
    );
    await check(
      "TV arrows move spatial focus and Enter activates a tile",
      async () => {
        await destination(page, "adaptive");
        await page.getByTestId("layout-tv").click();
        await layout(page, "tv");
        await page.locator('[data-tile="tile 1"]').focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("data-tile"),
          ),
          "tile 2",
        );
        await page.keyboard.press("Enter");
        await containsText(
          page,
          '[data-testid="dpad-focus"]',
          "tile 2 (activated)",
        );
        await page.keyboard.press("ArrowDown");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("data-tile"),
          ),
          "tile 8",
        );
        await page.getByTestId("layout-auto").click();
        await layout(page, "desktop");
      },
    );
    await check("TV Back returns to the previous destination", async () => {
      await destination(page, "overview");
      await destination(page, "adaptive");
      await page.getByTestId("layout-tv").click();
      await layout(page, "tv");
      await page.getByTestId("nav-adaptive").focus();
      await page.keyboard.press("Escape");
      await ready(page, "overview");
      await destination(page, "adaptive");
      await page.getByTestId("layout-auto").click();
      await layout(page, "desktop");
    });
    await check("Forms validate, preview valid values and reset", async () => {
      await destination(page, "forms");
      await page
        .getByRole("button", { name: "Preview profile", exact: true })
        .click();
      await page
        .getByText("Enter a name with at least two characters.", {
          exact: true,
        })
        .waitFor();
      await page.getByRole("textbox", { name: /Display name/ }).fill("Ada");
      await page
        .getByRole("textbox", { name: /Email address/ })
        .fill("ada@example.invalid");
      await page.getByLabel("These are local sample values").check();
      await page
        .getByRole("button", { name: "Preview profile", exact: true })
        .click();
      await containsText(page, "main [role=status]", "Valid preview ready.");
      assert.match(await page.locator("aside").innerText(), /Ada/);
      await page
        .getByRole("button", { name: "Reset form", exact: true })
        .click();
      assert.equal(
        await page.getByRole("textbox", { name: /Display name/ }).inputValue(),
        "",
      );
      assert.equal(
        await page.getByLabel("These are local sample values").isChecked(),
        false,
      );
      await containsText(
        page,
        "main [role=status]",
        "No profile has been saved.",
      );
    });
    await check(
      "Explorer selects and opens with keyboard, changes star, filters and grids",
      async () => {
        await destination(page, "explorer");
        const row = page
          .getByRole("row")
          .filter({ hasText: "Material notes.md" });
        await row.focus();
        await page.keyboard.press("Space");
        await containsText(
          page,
          "main [role=status]",
          "Selected Material notes.md",
        );
        assert.equal(await row.getAttribute("aria-selected"), "true");
        await page.keyboard.press("Enter");
        await containsText(
          page,
          "main [role=status]",
          "Opened local preview: Material notes.md",
        );
        await row.getByRole("button", { name: "Unstar", exact: true }).click();
        assert.equal(
          await row.getByRole("button", { name: "Star", exact: true }).count(),
          1,
        );
        const explorer = page.getByRole("region", {
          name: "Google Drive File List",
          exact: true,
        });
        await explorer.getByRole("button", { name: /^People/ }).click();
        assert.equal(await explorer.locator("tbody tr").count(), 2);
        await explorer
          .getByRole("button", { name: "Grid view", exact: true })
          .click();
        assert.equal(await explorer.locator("table").count(), 0);
        assert.equal(
          await explorer
            .getByRole("button", { name: "Design studies", exact: true })
            .count(),
          1,
        );
        assert.equal(
          await explorer
            .getByRole("button", { name: "Colour palette.json", exact: true })
            .count(),
          1,
        );
      },
    );
    await check(
      "Reader changes page and reading mode with local artwork",
      async () => {
        await destination(page, "reader");
        await containsText(page, "main [role=status]", "Illustration page: 1");
        await page
          .getByRole("button", { name: "Page suivante", exact: true })
          .click();
        await containsText(page, "main [role=status]", "Illustration page: 2");
        await page
          .getByRole("button", { name: "Page précédente", exact: true })
          .click();
        await containsText(page, "main [role=status]", "Illustration page: 1");
        await page
          .getByRole("button", {
            name: "Mode de lecture vertical (webtoon)",
            exact: true,
          })
          .click();
        const vertical = page.locator('main [aria-label$="lecture verticale"]');
        await vertical.waitFor();
        assert.equal(await vertical.getAttribute("tabindex"), "0");
        await page
          .getByRole("button", { name: "Annotated pages", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("button", { name: "Annotated pages", exact: true })
            .getAttribute("aria-pressed"),
          "true",
        );
        await page
          .getByText("Local demonstration page 1.", { exact: false })
          .first()
          .waitFor();
        assert.equal(
          (await page.locator('main img[src^="data:image/svg+xml"]').count()) >
            0,
          true,
        );
      },
    );
    await check(
      "Design generates inspectable CSS, tokens and React source",
      async () => {
        await destination(page, "design");
        await page
          .getByRole("textbox", { name: "Describe the interface", exact: true })
          .fill(
            "A minimal dashboard for developers, with a list-detail layout.",
          );
        await page
          .getByRole("button", { name: "Generate design", exact: true })
          .click();
        await containsText(
          page,
          "main [role=status]",
          "Design generated locally.",
        );
        const files = page.getByRole("combobox", { name: "File", exact: true });
        assert.equal(await files.locator("option").count(), 3);
        assert.match(
          await page.locator("main").innerText(),
          /--md-sys-color-primary/,
        );
        await files.selectOption("src/index.tsx");
        assert.match(await page.locator("main").innerText(), /@aphrody[/]/);
      },
    );
    await check(
      "AI fixture renders events and Stop restores the composer",
      async () => {
        await destination(page, "ai");
        await page
          .getByRole("textbox", {
            name: "Draft for the local protocol fixture",
            exact: true,
          })
          .fill("Inspect the package inventory.");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page
          .getByText(/Local protocol fixture: your draft contains/)
          .first()
          .waitFor();
        await page
          .getByRole("status")
          .filter({ hasText: /^Ready$/ })
          .waitFor();
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page.getByRole("button", { name: "Stop", exact: true }).click();
        await containsText(page, "main [role=status]", "Stream stopped.");
        await page
          .getByRole("button", { name: "Stop", exact: true })
          .waitFor({ state: "detached" });
        assert.equal(
          await page.getByRole("button", { name: "Stop", exact: true }).count(),
          0,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "Send", exact: true })
            .isEnabled(),
          true,
        );
      },
    );
    await check(
      "Local rendering has no console errors, HTTP failures or external requests",
      async () => {
        assert.deepEqual(report.consoleErrors, []);
        assert.deepEqual(report.httpFailures, []);
        assert.deepEqual(report.externalRequests, []);
      },
    );
  } finally {
    await context.close();
    await browser.close();
  }
  return report;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "bun apps/m3-showcase/scripts/browser-contract.ts [--url http://127.0.0.1:3312] [--out " +
        resolve(RUNS, "browser-contract.json") +
        "]",
    );
  } else {
    const value = (flag: string) => {
      const index = args.indexOf(flag);
      if (index < 0) return undefined;
      const next = args[index + 1];
      if (!next || next.startsWith("--"))
        throw new TypeError("Missing value for " + flag);
      return next;
    };
    const out = outputPath(value("--out"));
    const report = await browserContract(
      value("--url") ?? "http://127.0.0.1:3312",
    );
    await mkdir(dirname(out), { recursive: true });
    await Bun.write(out, JSON.stringify(report, null, 2) + "\n");
    const failures = report.checks.filter((check) => !check.passed);
    console.log(
      report.checks.length +
        " checks, " +
        failures.length +
        " failures; " +
        out,
    );
    if (failures.length) process.exitCode = 1;
  }
}
