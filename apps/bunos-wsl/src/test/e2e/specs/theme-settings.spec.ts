/**
 * E2E Tests for Theme Settings
 *
 * Tests the theme selection functionality:
 * - Seed grid display
 * - Seed switching (the engine re-derives the roles)
 * - Light/dark mode
 * - Custom seed option
 */

import { setupHooks, actions, isElementDisplayed } from "../base";
import { selectors } from "../utils";

async function waitForPressed(selector: string, timeoutMsg: string) {
  const element = await $(selector);
  await browser.waitUntil(async () => (await element.getAttribute("aria-pressed")) === "true", {
    timeout: 3000,
    timeoutMsg,
  });
  return element;
}

describe("Theme Settings", () => {
  setupHooks.standard();

  beforeEach(async () => {
    await actions.goToSettings();

    const appearanceTab = await $(selectors.settingsTab("appearance"));
    await appearanceTab.waitForClickable({ timeout: 5000 });
    await appearanceTab.click();

    await browser.waitUntil(async () => isElementDisplayed('[data-testid="theme-bun-os"]'), {
      timeout: 5000,
      timeoutMsg: "Theme grid did not appear",
    });
  });

  describe("Theme Grid", () => {
    it("should display the built-in seeds", async () => {
      for (const id of ["bun-os", "obsidian", "cobalt", "high-contrast"]) {
        await expect($(`[data-testid="theme-${id}"]`)).toBeDisplayed();
      }
    });

    it("should have Bun OS as default theme", async () => {
      const bunOs = await $('[data-testid="theme-bun-os"]');
      expect(await bunOs.getAttribute("aria-pressed")).toBe("true");
    });

    it("should switch to Cobalt and re-derive the primary role", async () => {
      const before = await browser.execute(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--md-sys-color-primary"),
      );
      await (await $('[data-testid="theme-cobalt"]')).click();
      await waitForPressed('[data-testid="theme-cobalt"]', "Cobalt theme selection did not update");
      await browser.waitUntil(
        async () =>
          (await browser.execute(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--md-sys-color-primary"),
          )) !== before,
        { timeout: 5000, timeoutMsg: "Primary role was not re-derived" },
      );
    });

    it("should select Custom theme when clicked", async () => {
      await (await $('[data-testid="theme-custom"]')).click();
      await waitForPressed('[data-testid="theme-custom"]', "Custom theme selection did not update");
      await expect($('[data-testid="theme-custom-seed"]')).toBeDisplayed();
    });
  });

  describe("Mode", () => {
    it("should switch to the light scheme", async () => {
      await (await $('[data-testid="theme-mode-light"]')).click();
      await browser.waitUntil(
        async () => (await browser.execute(() => document.documentElement.dataset.theme)) === "light",
        { timeout: 3000, timeoutMsg: "Light scheme was not applied" },
      );
    });
  });
});
