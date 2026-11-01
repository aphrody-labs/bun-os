// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { productArgs, VERSION } from "../src/cli.ts";

function run(...args: string[]) {
  return Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], {
    windowsHide: true,
    env: { ...process.env, APHRODY_SETUP_NO_UPDATE: "1" },
  });
}

test("one entrypoint contains setup, administrator and creator modules with the same version", () => {
  for (const role of [[], ["setup"], ["admin"], ["creator"]]) {
    const result = run(...role, "--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(VERSION);
  }
  expect(run("admin", "--help").stdout.toString()).toContain("entrainement");
  expect(run("creator", "--help").stdout.toString()).toContain("video-translate");
});

test("the single product entrypoint exposes the current administrator and creator catalogs", () => {
  const admin = run("admin", "--help");
  const creator = run("creator", "--help");
  expect(admin.exitCode).toBe(0);
  expect(creator.exitCode).toBe(0);
  expect(admin.stdout.toString()).toContain("entrainement");
  expect(creator.stdout.toString()).toContain("challonge");
  expect(run("--help").stdout.toString()).toContain("aphrody-product admin");
});

test("historical executable names select a role without a second implementation", () => {
  expect(productArgs(["verifier"], "Aphrody-Omar.exe")).toEqual(["admin", "verifier"]);
  expect(productArgs(["--help"], "creator-kit.exe")).toEqual(["creator", "--help"]);
  expect(productArgs(["--oui"], "Aphrody-Setup.exe")).toEqual(["--oui"]);
});
