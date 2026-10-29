// SPDX-License-Identifier: Apache-2.0
// `tiny-invariant` is served by the the former Bun fork runtime (src/js/thirdparty/tiny-invariant.ts, tools/config/bun-absorb.json);
// no npm package provides its types.
declare module "tiny-invariant" {
  export default function invariant(condition: unknown, message?: string | (() => string)): asserts condition;
}
