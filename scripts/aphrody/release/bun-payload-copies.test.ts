// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const copies = [
  [
    resolve(root, "crates/ai/agent-home/sync-contract.json"),
    resolve(dirname(Bun.resolveSync("@aphrody/google/api", import.meta.dir)), "sync-contract.json"),
  ],
];
for (const [source, packaged] of copies) {
  test(`packaged config preserves canonical owner: ${relative(root, source!)}`, async () => {
    expect(await Bun.file(packaged!).json()).toEqual(await Bun.file(source!).json());
  });
}
