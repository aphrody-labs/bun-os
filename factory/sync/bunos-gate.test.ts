// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { selectGateInputs } from "./bunos-gate.ts";

test("checks TypeScript, lints JavaScript, and excludes deleted generated outputs", () => {
  const ts = "apps/iecode-web/tests/browser-webgpu-smoke.ts";
  const js = "apps/iecode-web/webpack.config.js";
  const deleted = "apps/iecode-web/wii/pkg/gecko_web.js";
  const changed = [ts, js, deleted];
  const inputs = selectGateInputs(changed, new Set([ts, js]), () => true);
  expect(inputs.check).toEqual([ts]);
  expect(inputs.lint).toEqual([ts, js]);
  expect(inputs.format).toEqual([ts, js]);
});
