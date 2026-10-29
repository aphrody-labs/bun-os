// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { qualifyUiAllocation, type UiFactory } from "../../src/automation/build-factory-ui.ts";

const factory: UiFactory = {
  enabled: true,
  target: "vps",
  artifactRoot: "/home/ubuntu/build/artifacts",
  lockPath: "/home/ubuntu/build/locks/heavy.lock",
  rust: { maxJobs: 6 },
  ui: {
    enabled: true,
    classes: ["ui-reuse"],
    lockPath: "/home/ubuntu/build/locks/ui.lock",
    workRoot: "/home/ubuntu/build/artifacts/ui/jobs",
    maxJobs: 1,
    memoryGiB: 12,
    cpus: 4,
    reserveMemoryGiB: 8,
    reserveDiskGiB: 20,
    scratchGiB: 12,
    timeoutSeconds: 5400,
  },
};
const capacity = { availableMemoryGiB: 32, availableDiskGiB: 56, cores: 12 };

describe("declared UI factory allocation", () => {
  test("qualifies reuse inside the same factory without replacing the native lock", () => {
    expect(qualifyUiAllocation(factory, capacity)).toEqual(factory.ui);
    expect(factory.lockPath).toEndWith("/heavy.lock");
  });
  test.each([
    { availableMemoryGiB: 19, availableDiskGiB: 56, cores: 12 },
    { availableMemoryGiB: 32, availableDiskGiB: 31, cores: 12 },
    { availableMemoryGiB: 32, availableDiskGiB: 56, cores: 9 },
    { availableMemoryGiB: NaN, availableDiskGiB: 56, cores: 12 },
  ])("refuses insufficient or unknown capacity %j", observed => {
    expect(() => qualifyUiAllocation(factory, observed)).toThrow();
  });
  test.each([
    { lockPath: factory.lockPath },
    { workRoot: "/home/ubuntu/build/transient/ui" },
    { memoryGiB: 24 },
    { cpus: 8 },
    { reserveMemoryGiB: 1 },
    { timeoutSeconds: 0 },
    { enabled: false },
  ])("refuses an undeclared or unbounded allocation %j", change => {
    expect(() => qualifyUiAllocation({ ...factory, ui: { ...factory.ui, ...change } }, capacity)).toThrow();
  });
  test("refuses execution-only targets and absent UI declaration", () => {
    expect(() => qualifyUiAllocation({ ...factory, target: "dbfr" }, capacity)).toThrow();
    expect(() => qualifyUiAllocation({ ...factory, ui: undefined } as unknown as UiFactory, capacity)).toThrow();
  });
  test("refuses missing capacity fields and an unknown native budget", () => {
    expect(() => qualifyUiAllocation(factory, {} as typeof capacity)).toThrow("Unknown factory capacity");
    expect(() => qualifyUiAllocation({ ...factory, rust: { maxJobs: NaN } }, capacity)).toThrow(
      "Native allocation is unknown",
    );
  });
});
