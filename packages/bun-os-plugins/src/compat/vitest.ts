// SPDX-License-Identifier: MIT
/**
 * `bun:vitest` (and `vitest` under `bun test`) of the aphrody-labs/bun fork, on upstream Bun: the
 * `bun:test` API, with test callbacks receiving a vitest-style context (`{ expect, task, skip,
 * onTestFinished }`) as their first argument.
 */
import * as bunTest from "bun:test";

type Fn = (...args: any[]) => unknown;

function context(name: string) {
  return {
    expect: bunTest.expect,
    task: { name },
    skip(note?: string): never {
      throw new Error(`skipped${note ? `: ${note}` : ""}`);
    },
    onTestFinished: bunTest.onTestFinished,
  };
}

function wrapCallback(name: string, fn: Fn | undefined): Fn | undefined {
  if (typeof fn !== "function") return fn;
  // Done-callback style tests (fn.length > 1) keep their signature.
  if (fn.length > 1) return fn;
  return () => fn(context(name));
}

function wrapTest<T extends Fn>(base: T): T {
  const wrapped = ((name: string, fn?: Fn, options?: unknown) =>
    base(name, wrapCallback(name, fn), options)) as unknown as T;
  for (const key of ["skip", "only", "todo", "failing", "concurrent", "serial"] as const) {
    const variant = (base as unknown as Record<string, Fn | undefined>)[key];
    if (typeof variant === "function")
      (wrapped as unknown as Record<string, Fn>)[key] = (name: string, fn?: Fn, options?: unknown) =>
        variant(name, wrapCallback(name, fn), options);
  }
  for (const key of ["if", "skipIf", "todoIf", "each"] as const) {
    const variant = (base as unknown as Record<string, Fn | undefined>)[key];
    if (typeof variant === "function") (wrapped as unknown as Record<string, Fn>)[key] = variant.bind(base);
  }
  return wrapped;
}

export const test = wrapTest(bunTest.test);
export const it = test;
export const {
  describe,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  mock,
  spyOn,
  jest,
  vi,
  setSystemTime,
  onTestFinished,
  expectTypeOf,
} = bunTest;
export const suite = describe;

export default { ...bunTest, test, it, suite };
