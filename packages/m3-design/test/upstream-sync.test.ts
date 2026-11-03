// SPDX-License-Identifier: Apache-2.0
// The generated catalogs, brand table, Bun OS stacks and distributable skill stay in step with their owners.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { search, searchStack } from "../intelligence/ui-ux-pro-max/scripts/core.ts";
import { parseCsvRecords } from "../intelligence/ui-ux-pro-max/scripts/csv.ts";
import { generateBrandsCsv } from "../scripts/brands.ts";
import { staleSkillFiles } from "../scripts/build-skill.ts";
import { buildTree, DATA_DIR, readPin, staleFiles, vendorAvailable } from "../scripts/sync-upstream.ts";

describe("ui-ux-pro-max sync", () => {
  test.if(vendorAvailable())("data/ equals a fresh sync from the vendored fork", async () => {
    expect(await staleFiles(await buildTree(await readPin()))).toEqual([]);
  });

  test("brands.csv is the output of the token-owner generator", async () => {
    expect(await Bun.file(join(DATA_DIR, "brands.csv")).text()).toBe(await generateBrandsCsv());
    const ids = parseCsvRecords(await generateBrandsCsv()).map(row => row["Brand ID"]);
    expect(ids).toEqual(["m3-baseline-light", "m3-baseline-dark", "aphrody-product-light", "aphrody-product-dark"]);
  });

  test("skill/ui-ux-pro-max is the current build of the owner", async () => {
    expect(await staleSkillFiles()).toEqual([]);
  });
});

describe("Bun OS stacks and upstream additions", () => {
  test("native stacks point at libm3 and craft-ui", async () => {
    const cosmic = await searchStack("themed root view overlays", "iced-libcosmic");
    expect(cosmic.count).toBeGreaterThan(0);
    expect(JSON.stringify(cosmic.results)).toContain("libm3::cosmic::themed");
    const egui = await searchStack("visuals high contrast", "egui");
    expect(JSON.stringify(egui.results)).toContain("craft_ui::theme::aphrody");
    const m3 = await searchStack("token engine second palette", "m3");
    expect(JSON.stringify(m3.results)).toContain("crates/aphrody-m3-tokens");
  });

  test("the brand domain resolves the product theme", async () => {
    const result = await search("aphrody-product-dark", "brand");
    expect(result.results?.[0]?.["Brand ID"]).toBe("aphrody-product-dark");
  });

  test("upstream nuxt-ui 4.12 rows and RTL levels arrived", async () => {
    expect((await searchStack("UChart line area donut", "nuxt-ui")).count).toBeGreaterThan(0);
    const rtl = await search("saas", "product", 1, false, "full");
    expect(rtl.results?.[0]?.["rtl_level"]).toBe("full");
    expect(search("blue", "color", 3, false, "full")).rejects.toThrow();
  });
});
