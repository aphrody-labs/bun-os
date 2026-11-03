import { describe, expect, test } from "bun:test";
import { dbLookup, type GameDbEntry } from "../src/ui/files";

describe("game database lookup", () => {
  const entries: GameDbEntry[] = [1, 3, 5].map(code => ({
    code,
    "rom-size": 8,
    "save-type": "none",
  }));

  test("finds entries at both ends and in the middle", () => {
    for (const entry of entries) expect(dbLookup(entries, entry.code)).toBe(entry);
  });

  test("returns undefined for an empty database and missing codes", () => {
    expect(dbLookup([], 1)).toBeUndefined();
    for (const code of [0, 2, 4, 6]) expect(dbLookup(entries, code)).toBeUndefined();
  });
});
