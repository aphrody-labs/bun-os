// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { runWordcraftImageSteps, requirePackageVersion, validateWordcraftGate } from "./wordcraft-image.ts";

test("requires a green gate for the exact published revision", () => {
  const sha = "a".repeat(40);
  expect(() => validateWordcraftGate({ sha, green: true }, sha, sha)).not.toThrow();
  for (const [gate, head, origin] of [
    [{ sha, green: false }, sha, sha],
    [{ sha: "b".repeat(40), green: true }, sha, sha],
    [{ sha, green: true }, sha, "b".repeat(40)],
    [{ sha: "", green: true }, "", ""],
  ] as const)
    expect(() => validateWordcraftGate(gate, head, origin)).toThrow();
});

test("packages before building and verifying the unified image", async () => {
  const calls: string[] = [];
  await runWordcraftImageSteps({
    async buildPackage() {
      calls.push("package");
    },
    async buildCraftCli() {
      calls.push("craft-cli");
    },
    async buildImage() {
      calls.push("image");
    },
    async verifyImage() {
      calls.push("verify");
    },
  });
  expect(calls).toEqual(["package", "craft-cli", "image", "verify"]);
});

test("a failed package or image never qualifies later stages", async () => {
  for (const fail of ["package", "craft-cli", "image", "verify"]) {
    const calls: string[] = [];
    const step = async (name: string) => {
      calls.push(name);
      if (name === fail) throw new Error(name);
    };
    await expect(
      runWordcraftImageSteps({
        buildPackage: () => step("package"),
        buildCraftCli: () => step("craft-cli"),
        buildImage: () => step("image"),
        verifyImage: () => step("verify"),
      }),
    ).rejects.toThrow(fail);
    expect(calls).toEqual(
      ["package", "craft-cli", "image", "verify"].slice(
        0,
        ["package", "craft-cli", "image", "verify"].indexOf(fail) + 1,
      ),
    );
  }
});

test("rejects missing and stale image package versions", () => {
  const expected = "1.0.0+bunos1234567890";
  expect(() => requirePackageVersion("Craft CLI", expected, expected)).not.toThrow();
  expect(() => requirePackageVersion("Craft CLI", "", expected)).toThrow();
  expect(() => requirePackageVersion("Craft CLI", "1.0.0+bunos0987654321", expected)).toThrow();
});
