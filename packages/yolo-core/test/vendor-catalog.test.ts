// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunCheckout, generateBunCatalog } from "../src/vendor/catalog";

const roots: string[] = [];
test("Bun checkout discovery follows the relocated workspace and configured owner", () => {
  const parent = mkdtempSync(join(tmpdir(), "yolo-relocated-checkouts-"));
  roots.push(parent);
  const workspace = join(parent, "aphrody");
  const bun = join(workspace, "sources", "bun");
  mkdirSync(workspace);
  mkdirSync(join(bun, "docs"), { recursive: true });
  expect(bunCheckout({ APHRODY_WORKSPACE_ROOT: workspace })).toBe(bun);
  const configured = join(parent, "custom-bun");
  mkdirSync(join(configured, "docs"), { recursive: true });
  expect(
    bunCheckout({
      APHRODY_WORKSPACE_ROOT: workspace,
      APHRODY_BUN_CHECKOUT: configured,
    }),
  ).toBe(configured);
});
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yolo-catalog-format-"));
  roots.push(root);
  for (const directory of ["vendor/bun/docs", "vendor/bun/packages/bun-types", "vendor/bun/.git"])
    mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "vendor/bun/docs/fetch.md"), "# Fetch fixture\n");
  writeFileSync(join(root, "vendor/bun/packages/bun-types/bun.d.ts"), "export declare const fixture: boolean;\n");
  writeFileSync(join(root, "vendor/bun/.git/HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(root, "vendor/bun/.git/packed-refs"), `${sourceRevision} refs/heads/main\n`);
  return root;
}
test("catalog produces a formatted artifact with source/runtime provenance and stable repeated output", async () => {
  const root = fixture();
  const report = await generateBunCatalog(root);
  expect(report.sourceRevision).toBe(sourceRevision);
  expect(report.bunRevision).toBe(Bun.revision);
  expect(report.totalDocFilesIndexed).toBe(1);
  expect(existsSync(report.targetCatalogPath)).toBe(true);
  const first = await Bun.file(report.targetCatalogPath).text();
  expect(first).toContain(`vendor/bun (commit: ${sourceRevision})`);
  const generated = await import(report.targetCatalogPath);
  expect(generated.MONOREPO_BUN_CATALOG.sourceRevision).toBe(sourceRevision);
  expect(generated.MONOREPO_BUN_CATALOG.bunRevision).toBe(Bun.revision);
  const check = Bun.spawnSync([process.execPath, "fmt", "--check", report.targetCatalogPath], {
    windowsHide: true,
  });
  expect(check.exitCode).toBe(0);
  await generateBunCatalog(root);
  expect(await Bun.file(report.targetCatalogPath).text()).toBe(first);
  expect(readdirSync(join(root, "packages/app-ui/src/generated"))).toEqual(["bun-catalog.ts"]);
});
test("missing checkout data fails before producing a misleading catalog", async () => {
  const root = fixture();
  rmSync(join(root, "vendor/bun/docs"), { recursive: true });
  await expect(generateBunCatalog(root)).rejects.toThrow("source data");
  expect(existsSync(join(root, "packages/app-ui/src/generated/bun-catalog.ts"))).toBe(false);
});
