// SPDX-License-Identifier: MIT
// The Bun port against upstream's Python on fixed inputs (fixtures written once by scripts/golden.ts through
// `uv run`): same ranking, scores, hashes, records and quality brief, value for value.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { contextCommand, resolveCommand, searchCommand } from "../src/commands.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const golden = (await Bun.file(join(FIXTURES, "golden.json")).json()) as {
  commit: string;
  search: { args: string[]; output: unknown }[];
  resolve: { args: string[]; output: unknown }[];
  context: { args: string[]; output: unknown }[];
};
const fill = (args: string[]) => args.map(a => a.replace(/^\{(HOST_T[23])\}$/, (_, h: string) => join(FIXTURES, `${h}.json`)));
const upstream = (await Bun.file(join(import.meta.dir, "../upstream/UPSTREAM.json")).json()) as { commit: string };

test("the fixtures were recorded on the pinned fork commit", () => {
  expect(golden.commit).toBe(upstream.commit);
});

describe("search.py parity", () => {
  for (const { args, output } of golden.search) {
    test(args.join(" "), () => {
      expect(searchCommand(args)).toEqual(output as never);
    });
  }
});

describe("resolve.py parity", () => {
  for (const { args, output } of golden.resolve) {
    test(args.join(" "), () => {
      expect(JSON.parse(JSON.stringify(resolveCommand(args)))).toEqual(output as never);
    });
  }
});

describe("design-context.py parity", () => {
  for (const { args, output } of golden.context) {
    test(args.join(" "), () => {
      expect(JSON.parse(JSON.stringify(contextCommand(fill(args))))).toEqual(output as never);
    });
  }
});

describe("hero-tier.py cache key parity", () => {
  const hero = (golden as unknown as { hero: { args: string[]; output: Record<string, unknown> }[] }).hero;
  const project = join(import.meta.dir, "..");
  for (const { args, output } of hero) {
    test(args.join(" "), async () => {
      const { heroTier } = await import("../src/hero-tier.ts");
      const out = join(project, ".cache/hero-tier/golden.glb");
      const { code, summary } = await heroTier([...args, "--root", project, "--out", out, "--host", join(FIXTURES, "HOST_T2.json")]);
      expect(code).toBe(0);
      const { out: _a, ...mine } = summary as Record<string, unknown>;
      const { out: _b, ...theirs } = output;
      expect(mine).toEqual(theirs);
    });
  }
});
