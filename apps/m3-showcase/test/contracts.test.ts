// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptiveFor, parseOverride } from "@aphrody/app-ui/material/adaptive/window.ts";
import { pickNext } from "@aphrody/app-ui/material/adaptive/dpad.ts";
import { parseRoute } from "../src/router.ts";
import { collect } from "../scripts/inventory.ts";
import { plan } from "../scripts/shots.ts";

const root = mkdtempSync(join(tmpdir(), "m3-showcase-contract-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
describe("adaptive showcase contracts", () => {
  test("viewport and explicit TV preferences are independent", () => {
    const mobile = adaptiveFor({
      width: 390,
      height: 844,
      userAgent: "",
      override: null,
      touch: true,
    });
    expect(mobile.mode).toBe("mobile");
    expect(mobile.width).toBe("compact");
    const tv = adaptiveFor({
      width: 390,
      height: 844,
      userAgent: "",
      override: "tv",
      touch: false,
    });
    expect(tv.mode).toBe("tv");
    const desktop = adaptiveFor({
      width: 1280,
      height: 800,
      userAgent: "SMART-TV",
      override: "desktop",
      touch: false,
    });
    expect(desktop.tv).toBe(false);
    expect(desktop.source).toBe("override");
    expect(parseOverride("?layout=mobile", "tv")).toBe("mobile");
    expect(parseOverride("?tv", null)).toBe("tv");
    expect(parseOverride("?layout=invalid", null)).toBeNull();
  });
  test("D-pad selects an aligned target and never moves backwards", () => {
    const from = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(
      pickNext(
        from,
        [
          {
            item: "aligned",
            box: { left: 0, top: 150, right: 100, bottom: 250 },
          },
          {
            item: "side",
            box: { left: 200, top: 110, right: 300, bottom: 210 },
          },
          {
            item: "behind",
            box: { left: 0, top: -150, right: 100, bottom: -50 },
          },
        ],
        "down",
      ),
    ).toBe("aligned");
    expect(pickNext(from, [], "left")).toBeUndefined();
  });
  test("hash destinations preserve direct links", () => {
    expect(parseRoute("#/theme")).toBe("theme");
    expect(parseRoute("#/reader/?page=2")).toBe("reader");
    expect(parseRoute("")).toBe("overview");
  });
  test("inventory uses the selected workspace's exclusions", () => {
    mkdirSync(join(root, "packages/private"), { recursive: true });
    mkdirSync(join(root, "packages/public"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        workspaces: { packages: ["packages/*", "!packages/private"] },
      }),
    );
    for (const name of ["private", "public"])
      writeFileSync(
        join(root, "packages", name, "package.json"),
        JSON.stringify({ name: `@fixture/${name}`, version: "1.0.0" }),
      );
    const entries = collect(root);
    expect(
      entries.find((entry) => entry.name === "@fixture/private")!.workspace,
    ).toBe(false);
    expect(
      entries.find((entry) => entry.name === "@fixture/public")!.workspace,
    ).toBe(true);
  });
  test("capture planning rejects output traversal and invalid layout input", () => {
    expect(() => plan(["../../outside"])).toThrow("Unknown showcase route");
    expect(() => plan(["overview"], ["bad" as "tv"])).toThrow("Unknown layout");
    expect(
      plan(["overview", "adaptive"], ["mobile", "tv"], ["light", "dark"]),
    ).toHaveLength(8);
  });
});
