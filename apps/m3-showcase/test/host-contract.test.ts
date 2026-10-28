// SPDX-License-Identifier: Apache-2.0
import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { APHRODY_ROOT, SHOWCASE_ROOT, TAURI_ROOT, ICON_SOURCE, generateIcons } from "../scripts/icons";
import { DESKTOP_ROOT, CARGO_RUNNER, runTauri, sidecarCommand, tauriHostPlan } from "../scripts/tauri";
import { productBuildContext } from "../../../packages/product/src/build-inputs";

test("showcase delegates to the existing desktop with its own source root", async () => {
  expect(DESKTOP_ROOT).toBe(resolve(APHRODY_ROOT, "apps/aphrody-app"));
  expect(TAURI_ROOT).toBe(DESKTOP_ROOT);
  expect(CARGO_RUNNER).toBe(resolve(APHRODY_ROOT, "scripts/cargo.ts"));
  expect(await Bun.file(ICON_SOURCE).exists()).toBe(true);
  expect(await Bun.file(resolve(DESKTOP_ROOT, "Cargo.toml")).exists()).toBe(true);
  const config = await Bun.file(resolve(DESKTOP_ROOT, "tauri.conf.json")).json();
  expect(config.build.frontendDist).toBe("ui-dist");
  expect(
    productBuildContext({
      NODE_ENV: "test",
      APHRODY_WORKSPACE_ROOT: APHRODY_ROOT,
      APHRODY_BUN_CHECKOUT: resolve(APHRODY_ROOT, "sources/bun"),
    }).uiDist,
  ).toBe(resolve(DESKTOP_ROOT, "ui-dist"));
  const plan = tauriHostPlan(["info"], "win32", () => null);
  expect(plan.apiOwner).toBe(SHOWCASE_ROOT);
  expect(plan.desktopOwner).toBe(DESKTOP_ROOT);
  expect(plan.launch).toBe("aphrody-app --showcase");
  expect(plan.missing).toEqual([]);
  expect(sidecarCommand("x86_64-pc-windows-msvc")).toContain(resolve(APHRODY_ROOT, "packages/m3-bun/bin/m3-bun.ts"));
});

test("plans are read-only and reject separate Rust shells and unsupported mobile hosts", async () => {
  const output = spyOn(console, "log").mockImplementation(() => {});
  const which = spyOn(Bun, "which").mockReturnValue("fixture-cli");
  try {
    await runTauri(["--plan", "sidecar"]);
    expect(JSON.parse(String(output.mock.calls[0]?.[0])).apiOwner).toBe(SHOWCASE_ROOT);
    await generateIcons(["--plan"]);
    expect(JSON.parse(String(output.mock.calls[1]?.[0])).output).toBe(resolve(DESKTOP_ROOT, "icons"));
  } finally {
    which.mockRestore();
    output.mockRestore();
  }
  await expect(runTauri(["prepare"])).rejects.toThrow("no separate Rust shell");
  await expect(runTauri(["android", "build"])).rejects.toThrow("explicit owner command");
  expect(() => sidecarCommand("aarch64-linux-android")).toThrow("canonical API host adapter");
});
