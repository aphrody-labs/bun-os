// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  runWordcraftImageSteps,
  validateWordcraftGate,
} from "./wordcraft-image.ts";

test("requires a green gate for the exact published revision", () => {
  const sha = "a".repeat(40);
  expect(() =>
    validateWordcraftGate({ sha, green: true }, sha, sha),
  ).not.toThrow();
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
    async buildImage() {
      calls.push("image");
    },
    async verifyImage() {
      calls.push("verify");
    },
  });
  expect(calls).toEqual(["package", "image", "verify"]);
});

test("a failed package or image never qualifies later stages", async () => {
  for (const fail of ["package", "image", "verify"]) {
    const calls: string[] = [];
    const step = async (name: string) => {
      calls.push(name);
      if (name === fail) throw new Error(name);
    };
    await expect(
      runWordcraftImageSteps({
        buildPackage: () => step("package"),
        buildImage: () => step("image"),
        verifyImage: () => step("verify"),
      }),
    ).rejects.toThrow(fail);
    expect(calls).toEqual(
      ["package", "image", "verify"].slice(
        0,
        ["package", "image", "verify"].indexOf(fail) + 1,
      ),
    );
  }
});
