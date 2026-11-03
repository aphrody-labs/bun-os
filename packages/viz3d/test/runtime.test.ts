// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutable } from "@aphrody/chromium/chromium";
import { capture, parseCaptureArgs } from "../src/capture.ts";
import { pyFloatRepr } from "../src/pyjson.ts";
import { serve } from "../src/server.ts";
import { tokens } from "../src/text.ts";
import { validateDataset } from "../src/validate.ts";
import { classify, THRESHOLDS } from "../src/view-quality.ts";

test("Python float repr and tokenizer", () => {
  expect([1, 0.1, 1e-5, 1e16, 1e15, 2.5e-7, -0.0].map(pyFloatRepr)).toEqual(["1.0", "0.1", "1e-05", "1e+16", "1000000000000000.0", "2.5e-07", "-0.0"]);
  expect(tokens("Rubik’s 3×3 cube, Straße")).toEqual(["rubik'", "s", "3×3", "cube", "strasse"]);
});

test("the dataset validates and its counts match upstream's summary", () => {
  const report = validateDataset();
  expect(report.errors).toEqual([]);
  expect(report.counts).toEqual({ recipes: 223, knowledge: 440, blueprints: 22, sources: 451, directions: 24 });
});

test("view quality verdicts", () => {
  const base = { luma_mean: 0.5, luma_std: 0.1, dark_fraction: 0, flat_fraction: 0, flat_luma: null, rest_luma: 0.5 };
  expect(classify(base, THRESHOLDS)).toEqual([true, "usable"]);
  expect(classify({ ...base, luma_mean: 0.02 })[1]).toBe("near-black");
  expect(classify({ ...base, flat_fraction: 0.5, flat_luma: 0.9, rest_luma: 0.3 })[1]).toBe("flat-occluder");
  expect(classify({ ...base, luma_std: 0.01 })[1]).toBe("low-contrast");
});

describe("scene server", () => {
  test("kit pages, three and path safety", async () => {
    const server = await serve({ mode: "kit" });
    try {
      const index = await (await fetch(server.url)).text();
      expect(index.match(/href="\/kit\/knowledge\.blueprint-[a-z-]+\/"/g)?.length).toBe(22);
      const page = await (await fetch(`${server.url}kit/knowledge.blueprint-cart/?tier=T2`)).text();
      expect(page).toContain('"three":"/three/build/three.webgpu.js"');
      expect(page).toContain('<meta name="surface"');
      expect((await fetch(`${server.url}three/build/three.webgpu.js`)).status).toBe(200);
      expect((await fetch(`${server.url}kits/..%2F..%2Fdata/manifest.json`)).status).toBe(404);
      expect((await fetch(`${server.url}kit/knowledge.nope/`)).status).toBe(400);
    } finally {
      server.stop();
    }
  });

  test("studies get an import map; missing meshes redirect to the hosted bucket", async () => {
    const server = await serve({ mode: "study" });
    try {
      expect(await (await fetch(`${server.url}cottage/`)).text()).toContain('"three":"/three/build/three.module.js"');
      const mesh = await fetch(`${server.url}assets/anatomy/FMA13322.stl`, { redirect: "manual" });
      expect([200, 302]).toContain(mesh.status);
    } finally {
      server.stop();
    }
  });
});

test.skipIf(!findExecutable())("a kit renders and captures end to end", async () => {
  const out = mkdtempSync(join(tmpdir(), "viz3d-capture-"));
  try {
    const result = await capture(parseCaptureArgs(["--kit", "knowledge.blueprint-crate", "--all-views", "--out", out, "--timeout-s", "60"])!);
    expect(result.status).toBe(0);
    expect(result.log.views.map((v: { name: string }) => v.name)).toEqual(["default", "far", "mid", "close", "detail"]);
    expect(result.log.kit_info.triangles).toBeGreaterThan(0);
    expect(["webgpu", "webgl2"]).toContain(result.log.scene_backend);
    expect(readdirSync(out)).toContain("mid.png");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 120_000);

test("the generated skill is Bun-only and runs from its own folder", () => {
  const skill = join(import.meta.dir, "../plugin/skills/3dviz-pro-max");
  const text = readFileSync(join(skill, "SKILL.md"), "utf8");
  expect(text).toContain("## Bun OS");
  expect(text).not.toMatch(/python3 scripts\//);
  for (const name of ["search", "resolve", "design-context", "host-probe", "blender-locate", "hero-tier", "capture", "serve", "validate"])
    expect(existsSync(join(skill, "scripts", `${name}.js`))).toBe(true);
  const run = Bun.spawnSync([process.execPath, "scripts/search.js", "timber cottage at dusk", "--limit", "1"], { cwd: skill });
  expect(JSON.parse(run.stdout.toString()).results[0].id).toBe("knowledge.blueprint-timber-cottage");
});
