// SPDX-License-Identifier: Apache-2.0
// Coverage gate: every member of the repository has a WebOS surface (page, API record, reason); a new member
// cannot be added without one. Same check as `bun apps/webos/inventory.ts --check`.
import { expect, test } from "bun:test";
import { buildInventory, checkInventory } from "../inventory";
import { KIND_IDS } from "../src/inventory-kinds";

test("every member of apps, packages, crates, docs, factory, tools, infra, sources and root has a WebOS surface", async () => {
  const inventory = await buildInventory();
  const { errors } = await checkInventory(inventory);
  expect(errors).toEqual([]);
  for (const kind of KIND_IDS) if (kind !== "games") expect(inventory.counts[kind]).toBeGreaterThan(0);
});
