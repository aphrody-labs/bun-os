// SPDX-License-Identifier: Apache-2.0 AND MIT
// The Bun search reproduces upstream's Python search.py (nextlevelbuilder/ui-ux-pro-max-skill, MIT) on the same
// catalogs: same domain routing, ranking, projected columns, suggestions and RTL filtering. The golden was produced
// once by scripts/upstream-golden.ts through `uv run`; Python is not needed to run this test.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { dataFingerprint, GOLDEN_FILE, GOLDEN_QUERIES } from "../scripts/upstream-golden.ts";
import { readPin } from "../scripts/sync-upstream.ts";

const SEARCH = join(import.meta.dir, "..", "intelligence", "ui-ux-pro-max", "scripts", "search.ts");
const golden = (await Bun.file(GOLDEN_FILE).json()) as {
  upstreamCommit: string;
  dataFingerprint: string;
  cases: { args: string[]; result: unknown }[];
};

describe("upstream Python golden", () => {
  test("was generated for the pinned upstream commit, the current catalogs and the current query set", async () => {
    expect(golden.upstreamCommit).toBe((await readPin()).upstreamCommit);
    // A mismatch means data changed after a sync: rerun `bun run golden:upstream`.
    expect(golden.dataFingerprint).toBe(await dataFingerprint());
    expect(golden.cases.map(item => item.args)).toEqual(GOLDEN_QUERIES);
  });

  for (const { args, result } of golden.cases) {
    test(`search.ts ${args.join(" ")}`, () => {
      const proc = Bun.spawnSync([process.execPath, SEARCH, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
      expect(proc.stderr.toString()).toBe("");
      expect(JSON.parse(proc.stdout.toString())).toEqual(result);
    });
  }
});
