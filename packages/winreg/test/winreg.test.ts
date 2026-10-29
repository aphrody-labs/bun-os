import { expect, test } from "bun:test";
import * as shim from "../src";
import * as registry from "@aphrody/windows/registry";

test("@aphrody/winreg re-exports @aphrody/windows/registry", () => {
  expect(Object.keys(shim).sort()).toEqual(Object.keys(registry).sort());
  expect(shim.get).toBe(registry.get);
});
