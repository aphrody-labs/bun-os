import { describe, expect, test } from "bun:test";
import { loadConsoleCatalog, validateConsoleCatalog, type ConsoleCatalog } from "../src/console/catalog";

describe("console plugin catalog", () => {
  test("validates every local owner and pinned submodule", async () => {
    const catalog = await loadConsoleCatalog();
    expect(await validateConsoleCatalog(catalog)).toEqual([]);
    expect(catalog.components).toHaveLength(30);
    expect(catalog.kernelIntegration).toBe("unified");
  });

  test("rejects kernel linkage, floating revisions and escaped paths", async () => {
    const catalog = structuredClone(await loadConsoleCatalog()) as ConsoleCatalog;
    Object.assign(catalog, { kernelIntegration: "default" });
    catalog.components[0]!.sourceRev = "main";
    catalog.components[0]!.sources[0]!.path = "../private-firmware";
    expect(await validateConsoleCatalog(catalog)).toEqual(
      expect.arrayContaining([
        "kernelIntegration must be unified",
        "components[0].sourceRev must be a full git SHA",
        "components[0].sources[0].path escapes owned source roots",
      ]),
    );
  });

  test("keeps license metadata separate from publication approval", async () => {
    const catalog = structuredClone(await loadConsoleCatalog()) as ConsoleCatalog;
    for (const component of catalog.components) component.publicationGate = "deferred-review";
    expect(await validateConsoleCatalog(catalog)).toEqual([]);
  });
});
