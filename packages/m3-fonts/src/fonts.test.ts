// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  FONT_STACKS,
  FONTS,
  renderStylesheet,
  SHEET_FILES,
  SUBSET_JOBS,
  SUBSETS,
  UPSTREAM_DIR,
  type FontSheet,
} from "./index";

const root = join(import.meta.dir, "..");
const lock = (await Bun.file(join(root, "fonts.lock.json")).json()) as {
  sources: { "google-fonts": { submodule: string } };
  files: { dest: string; sha256: string; bytes: number }[];
  tracked: { file: string; path: string; sha256: string; bytes: number }[];
};
const fork = join(root, "../..", lock.sources["google-fonts"].submodule);
const forkMaterialised = existsSync(join(fork, "ofl")); // directory: Bun.file().exists() is false for dirs
const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(path).bytes()).digest("hex");
const size = (path: string) => Bun.file(path).size;
const magic = async (path: string) => (await Bun.file(path).slice(0, 4).bytes()).toHex();
const SYNC_HINT = "run `bun scripts/m3/fonts-sync.ts` at the repository root";
const WOFF2 = "774f4632";
const sheetBytes = (sheet: FontSheet) =>
  FONTS.filter(f => f.sheet === sheet)
    .flatMap(f => f.faces)
    .reduce((n, f) => n + size(join(root, f.file)), 0);
const SFNT = ["00010000", "74727565", "4f54544f"]; // TrueType, true, OTTO

describe("@aphrody/m3-fonts upstream sources (fonts.lock.json)", () => {
  test("every pinned source is synced into fonts/upstream with its sha256", async () => {
    await Promise.all(
      lock.files.map(async entry => {
        const file = join(root, UPSTREAM_DIR, entry.dest);
        expect(await Bun.file(file).exists(), `${entry.dest} missing: ${SYNC_HINT}`).toBe(true);
        expect(size(file), entry.dest).toBe(entry.bytes);
        expect(await sha256(file), `${entry.dest} differs from fonts.lock.json: ${SYNC_HINT}`).toBe(entry.sha256);
      }),
    );
  });

  test("every upstream path the manifest uses is pinned in the lock", () => {
    const pinned = new Set(lock.files.map(e => `${UPSTREAM_DIR}/${e.dest}`));
    const used = [
      ...FONTS.map(f => f.sourceFile),
      ...FONTS.flatMap(f => f.faces.map(x => x.file)),
      ...SUBSET_JOBS.map(j => j.source),
    ];
    for (const path of used.filter(p => p.startsWith(`${UPSTREAM_DIR}/`))) expect(pinned.has(path), path).toBe(true);
  });

  test("the tracked variable sources are the pinned bytes", async () => {
    await Promise.all(
      lock.tracked.map(async t => {
        expect(size(join(root, t.file)), t.file).toBe(t.bytes);
        expect(await sha256(join(root, t.file)), t.file).toBe(t.sha256);
      }),
    );
  });

  test.skipIf(!forkMaterialised)(
    `the tracked variable sources come from vendor/fonts at the pinned commit${forkMaterialised ? "" : " [skipped: vendor/fonts is not vendored]"}`,
    async () => {
      await Promise.all(lock.tracked.map(async t => expect(await sha256(join(fork, t.path)), t.path).toBe(t.sha256)));
    },
  );

  test("the tracked OFL texts of the Google Sans subsets are the pinned upstream licences", async () => {
    await Promise.all(
      (
        [
          ["fonts/GoogleSansFlex-OFL.txt", "google-sans-flex/OFL.txt"],
          ["fonts/GoogleSansCode-OFL.txt", "google-sans-code/OFL.txt"],
        ] as const
      ).map(async ([tracked, dest]) => {
        expect(await sha256(join(root, tracked))).toBe(lock.files.find(e => e.dest === dest)!.sha256);
      }),
    );
  });
});

describe("@aphrody/m3-fonts", () => {
  test("every subset job produced WOFF2 faces with a unicode-range", () => {
    for (const job of SUBSET_JOBS) {
      const faces = SUBSETS.filter(s => s.id === job.id);
      expect(faces.length).toBeGreaterThan(0);
      if (job.japanese) expect(faces.length).toBeGreaterThan(5);
      for (const f of faces) {
        expect(f.unicodeRange).toMatch(/^U\+[0-9A-F]{4}/);
        expect(size(join(root, f.file))).toBe(f.bytes);
      }
    }
  });

  test("every face, source and license file exists and is a real font", async () => {
    await Promise.all(
      FONTS.map(async fam => {
        expect([WOFF2, ...SFNT]).toContain(await magic(join(root, fam.sourceFile)));
        await Promise.all(
          fam.faces.map(async f => {
            const p = join(root, f.file);
            expect(await Bun.file(p).exists()).toBe(true);
            expect(await magic(p)).toBe(WOFF2);
            expect(f.format).toBe("woff2");
            if (f.licenseFile) {
              expect(await Bun.file(join(root, f.licenseFile)).text()).toContain("SIL OPEN FONT LICENSE");
            }
          }),
        );
      }),
    );
  });

  test("core sheet stays small; Japanese and icon fonts live in their own sheets", () => {
    expect(sheetBytes("core")).toBeLessThan(3 * 1024 * 1024);
    for (const f of FONTS)
      expect(f.sheet).toBe(f.role === "icon" ? "symbols" : f.script === "japanese" ? "jp" : "core");
    // No Japanese chunk exceeds 300 KiB, so a page only pulls the blocks it renders.
    for (const f of FONTS.filter(x => x.sheet === "jp").flatMap(x => x.faces)) {
      expect(size(join(root, f.file))).toBeLessThan(300 * 1024);
    }
  });

  test("Japanese faces are range-limited and fall back after Latin faces, then system faces", () => {
    for (const f of FONTS.filter(x => x.script === "japanese")) {
      for (const face of f.faces) expect(face.unicodeRange).toBeDefined();
      expect(f.faces.some(x => x.unicodeRange?.includes("U+3042"))).toBe(false); // folded into a range
      expect(f.faces[0]?.unicodeRange).toContain("U+3041-");
    }
    expect(FONT_STACKS.plain.indexOf("Roboto Flex")).toBeLessThan(FONT_STACKS.plain.indexOf("Noto Sans JP"));
    expect(FONT_STACKS.code.indexOf("Roboto Mono")).toBeLessThan(FONT_STACKS.code.indexOf("M PLUS 1 Code"));
    for (const system of ["Segoe UI Variable Text", "Yu Gothic UI", "Noto Sans CJK JP", "Cantarell"]) {
      expect(FONT_STACKS.plain).toContain(system);
    }
    expect(FONT_STACKS.code).toContain("Cascadia Mono");
    expect(FONT_STACKS.plain.endsWith("sans-serif")).toBe(true);
  });

  test("stylesheets are in sync with the manifest", async () => {
    await Promise.all(
      (Object.entries(SHEET_FILES) as [FontSheet, string][]).map(async ([sheet, file]) => {
        // The committed sheets are reflowed by `bun format`; compare them whitespace-insensitively.
        const flat = (css: string) => css.replace(/s+/g, " ").trim();
        expect(flat(await Bun.file(join(root, "src", file)).text())).toBe(flat(renderStylesheet("../", sheet)));
      }),
    );
    expect(await Bun.file(join(root, "src", SHEET_FILES.core)).text()).not.toContain(".ttf");
  });
});
