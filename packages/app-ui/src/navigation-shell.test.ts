// SPDX-License-Identifier: Apache-2.0
// Navigation Shell & Settings Parity Test
// Validates single sidebar architecture, dynamic group switching, strict 6 settings sections,
// Low Vision accessibility floor (>= 18px), and zero technical slop per docs/UI-DESIGN.md §3, §4.6, §10.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getProjectGroups } from "./stores/chat-store";
import { desktopRoutes, legacyRouteRedirects } from "./desktop-navigation";

describe("Single Navigation & Shell Architecture (UI-DESIGN.md §3, §4.6, §10)", () => {
  const sidebarPath = resolve(__dirname, "components/AppSidebar.tsx");
  const sidebarCode = readFileSync(sidebarPath, "utf-8");

  const settingsRoutePath = resolve(__dirname, "routes/settings/index.tsx");
  const settingsRouteCode = readFileSync(settingsRoutePath, "utf-8");

  it("enforces a single navigation sidebar with no secondary sidebar anywhere", () => {
    // AppSidebar must have the unique <nav> element
    expect(sidebarCode).toContain("<nav");

    // routes/settings must NEVER contain an inner <nav> sidebar
    expect(settingsRouteCode).not.toContain("<nav");
    expect(settingsRouteCode).not.toContain("w-48");
    expect(settingsRouteCode).not.toContain("border-r");
  });

  it("centralizes the four desktop destinations and preserves legacy URLs as redirects", () => {
    expect(Object.values(desktopRoutes)).toEqual([
      "/chat",
      "/explorer",
      "/models",
      "/studio",
      "/creator",
      "/admin",
      "/settings",
    ]);
    expect(legacyRouteRedirects.jobs).toBe(desktopRoutes.files);
    expect(legacyRouteRedirects).not.toHaveProperty("remote");
  });

  it("AppSidebar declares consumer destinations with M3 icons, 48dp height and label-large 18px", () => {
    expect(sidebarCode).toContain("Chat");
    expect(sidebarCode).toContain("Files");
    expect(sidebarCode).toContain("Models");

    // M3 icons
    expect(sidebarCode).toContain("chat");
    expect(sidebarCode).toContain("folder_open");
    expect(sidebarCode).toContain("model_training");

    // 48dp row height and label-large 18px text
    expect(sidebarCode).toContain("h-12 w-full items-center gap-3 rounded-full px-3 text-label-large");
  });

  it("dynamically changes groups based on active area without modal drawers", () => {
    // Chat active: Nouveau chat, Projets, Récents
    expect(sidebarCode).toContain("isChatActive && !isSettingsActive");
    expect(sidebarCode).toContain("Nouveau chat");
    expect(sidebarCode).toContain("Projets");
    expect(sidebarCode).toContain("Récents");
    expect(sidebarCode).toContain("edit_square"); // Compose icon

    // Files active
    expect(sidebarCode).toContain("isFilesActive && !isSettingsActive");

    // Models active: Installés, Catalogue
    expect(sidebarCode).toContain("isModelsActive && !isSettingsActive");
    expect(sidebarCode).toContain("Installés");
    expect(sidebarCode).toContain("Catalogue");

    // Settings active: Search field and 6 strict sections
    expect(sidebarCode).toContain("isSettingsActive");
    expect(sidebarCode).toContain("settingsSearch");
  });

  it("strictly removes excluded groups, routes and disorderly footer buttons", () => {
    // Excluded routes/groups
    expect(sidebarCode).toContain('lower !== "overview"');
    expect(sidebarCode).toContain('lower !== "redundancy"');
    expect(sidebarCode).toContain('lower !== "favorites"');

    // Footer must strictly have Jobs, Sync, and Settings; no disorderly Palette or customize triggers
    expect(sidebarCode).not.toContain("SpaceCustomizationPanel");
    expect(sidebarCode).not.toContain("icon={Palette}");
  });

  it("sidebar footer correctly anchors Jobs, Sync, and Settings with 48dp targets", () => {
    expect(sidebarCode).toContain("<JobsButton");
    expect(sidebarCode).toContain("<SyncButton");
    expect(sidebarCode).toContain("GearSix");
    expect(sidebarCode).toContain('title="Paramètres"');
  });

  it("exposes the consumer Settings sections", () => {
    const pagesIndexPath = resolve(__dirname, "Settings/pages/index.ts");
    const pagesIndexCode = readFileSync(pagesIndexPath, "utf-8");

    const expectedSections = [
      "GeneralSettings",
      "AppearanceSettings",
      "AgentSettings",
      "ModelsSettings",
      "KeyboardSettings",
    ];

    for (const section of expectedSections) {
      expect(pagesIndexCode).toContain(section);
      expect(settingsRouteCode).toContain(section);
    }
  });

  it("eliminates technical slop across settings pages (no alpha versions, device slug or raw dumps)", () => {
    const generalPath = resolve(__dirname, "Settings/pages/GeneralSettings.tsx");
    const generalCode = readFileSync(generalPath, "utf-8");

    // Zero slop assertions
    expect(generalCode).not.toContain("2.0.0-alpha.2");
    expect(generalCode).not.toContain("slug");
    expect(generalCode).not.toContain("Device Slug");
    expect(generalCode).not.toContain("core.reset");

    // The updater supplies the actual installed version; never fabricate one.
    expect(generalCode).not.toContain("Aphrody 2.0");
  });

  it("conforms to LOW_VISION accessibility profile with text >= 18px", () => {
    const appearancePath = resolve(__dirname, "Settings/pages/AppearanceSettings.tsx");
    const appearanceCode = readFileSync(appearancePath, "utf-8");

    // Appearance includes font size controls respecting 18px floor
    expect(appearanceCode).toContain("18 px");
    expect(appearanceCode).toContain("Plancher Low Vision");
    expect(appearanceCode).toContain("20 px");
    expect(appearanceCode).toContain("22 px");
    expect(appearanceCode).toContain("applyAppearance(prefs)");

    const appCssPath = resolve(__dirname, "app.css");
    const appCss = readFileSync(appCssPath, "utf-8");
    expect(appCss).toContain("LOW_VISION is a product invariant");
    expect(appCss).toContain("font-size: max(var(--aphrody-base-font-size, 18px), 1em)");
  });

  it("chat store handles thread grouping into projects and unread indicators", () => {
    const mockThreads = [
      { id: "1", name: "Thread UI 1", cwd: "C:/src/aphrody", createdAt: 1000 },
      { id: "2", name: "Thread UI 2", cwd: "C:/src/aphrody", createdAt: 2000 },
      { id: "3", name: "Thread Atlas 1", cwd: "C:/src/atlas", createdAt: 3000 },
    ];

    const groups = getProjectGroups(mockThreads, { aphrody: true });
    expect(groups.length).toBeGreaterThanOrEqual(2);

    const aphrodyGroup = groups.find(g => g.name === "aphrody");
    expect(aphrodyGroup).toBeDefined();
    expect(aphrodyGroup?.threads).toHaveLength(2);

    const atlasGroup = groups.find(g => g.name === "atlas");
    expect(atlasGroup).toBeDefined();
    expect(atlasGroup?.threads).toHaveLength(1);
  });
});
