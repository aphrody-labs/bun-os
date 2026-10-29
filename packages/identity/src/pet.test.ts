// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";
import { compactPet, type RawAnimations, renderModule } from "./compact";
import { frameAt, gazeFrame, PET, spriteStyle, trackDuration } from "./pet";

const crateJson = join(findWorkspaceRoot(import.meta.dir), "crates/aphrody-identity/assets/aphrody/animations.json");

describe("generated pet data", () => {
  test("matches the crate animations.json (run `bun run gen` after a re-export)", async () => {
    const raw = (await Bun.file(crateJson).json()) as RawAnimations;
    const generated = await Bun.file(join(import.meta.dir, "animations.generated.ts")).text();
    // The committed module is run through the repo formatter, so compare without layout.
    const squash = (s: string) => s.replace(/\s+/g, "").replace(/,([)\]}])/g, "$1");
    expect(squash(generated)).toBe(squash(renderModule(compactPet(raw))));
  });

  test("atlas is the 8x11 grid of 192x208 cells", () => {
    expect(PET.atlas).toEqual({
      width: 1536,
      height: 2288,
      cellWidth: 192,
      cellHeight: 208,
      columns: 8,
      rows: 11,
    });
    expect(PET.directions).toHaveLength(16);
    expect(Object.keys(PET.tracks)).toContain("waving");
  });
});

describe("frameAt", () => {
  const idle = PET.tracks.idle!;

  test("accumulates durations", () => {
    expect(trackDuration(idle)).toBe(1100);
    expect(frameAt(idle, 0)).toBe(idle.frames[0]!);
    expect(frameAt(idle, 279)).toBe(idle.frames[0]!);
    expect(frameAt(idle, 280)).toBe(idle.frames[1]!);
  });

  test("loops, or holds the last frame of a single pass", () => {
    expect(frameAt(idle, 1100 + 280)).toBe(idle.frames[1]!);
    expect(frameAt(idle, 50_000, false)).toBe(idle.frames[idle.frames.length - 1]!);
  });

  test("still tracks never move", () => {
    const neutral = PET.tracks["look-neutral"]!;
    expect(frameAt(neutral, 12_345)).toBe(neutral.frames[0]!);
  });
});

describe("gazeFrame", () => {
  test("deadzone returns the neutral pose, otherwise the clockwise ring from up", () => {
    expect(gazeFrame(1, 1)).toBe(PET.tracks["look-neutral"]!.frames[0]!);
    expect(gazeFrame(0, -100)).toBe(PET.directions[0]!);
    expect(gazeFrame(100, 0)).toBe(PET.directions[4]!);
    expect(gazeFrame(0, 100)).toBe(PET.directions[8]!);
    expect(gazeFrame(-100, 0)).toBe(PET.directions[12]!);
  });
});

test("spriteStyle scales the whole atlas with the cell", () => {
  const f = PET.tracks.waving!.frames[1]!;
  expect(spriteStyle(f, 0.5)).toEqual({
    width: `${f.w / 2}px`,
    height: `${f.h / 2}px`,
    backgroundSize: "768px 1144px",
    backgroundPosition: `${-f.x / 2}px ${-f.y / 2}px`,
  });
});
