// SPDX-License-Identifier: Apache-2.0
import { statfsSync } from "node:fs";
import { posix } from "node:path";
import type { BuildFactoryConfig } from "./build-factory.ts";
import { factoryLeaseHeld } from "./build-factory-cleanup.ts";

export interface UiAllocation {
  enabled: boolean;
  classes: string[];
  lockPath: string;
  workRoot: string;
  maxJobs: 1;
  memoryGiB: number;
  cpus: number;
  reserveMemoryGiB: number;
  reserveDiskGiB: number;
  scratchGiB: number;
  timeoutSeconds: number;
}

export type UiFactory = Pick<BuildFactoryConfig, "enabled" | "target" | "artifactRoot" | "lockPath" | "rust"> & {
  ui: UiAllocation;
};

export interface UiCapacity {
  availableMemoryGiB: number;
  availableDiskGiB: number;
  cores: number;
}

export function qualifyUiAllocation(factory: UiFactory, capacity: UiCapacity): UiAllocation {
  const ui = factory.ui;
  if (!factory.enabled || factory.target !== "vps" || !ui?.enabled)
    throw Error("Canonical factory UI allocation is disabled");
  if (
    !ui.classes?.length ||
    ui.classes.some(name => typeof name !== "string" || !name) ||
    ui.maxJobs !== 1 ||
    ui.lockPath !== posix.join(posix.dirname(factory.lockPath), "ui.lock") ||
    ui.workRoot !== posix.join(factory.artifactRoot, "ui", "jobs")
  )
    throw Error("UI allocation must remain inside the canonical factory and outside transient cleanup");
  if (
    !posix.isAbsolute(factory.artifactRoot) ||
    posix.normalize(factory.artifactRoot) !== factory.artifactRoot ||
    !posix.isAbsolute(factory.lockPath) ||
    posix.normalize(factory.lockPath) !== factory.lockPath ||
    ui.lockPath === factory.lockPath
  )
    throw Error("Invalid factory paths");
  for (const value of [ui.memoryGiB, ui.cpus, ui.reserveMemoryGiB, ui.reserveDiskGiB, ui.scratchGiB])
    if (!Number.isSafeInteger(value) || value < 1) throw Error("Invalid UI resource limits");
  if (
    ui.memoryGiB < 12 ||
    ui.memoryGiB > 16 ||
    ui.cpus > 4 ||
    ui.reserveMemoryGiB < 8 ||
    ui.reserveDiskGiB < 20 ||
    !Number.isSafeInteger(ui.timeoutSeconds) ||
    ui.timeoutSeconds < 60 ||
    ui.timeoutSeconds > 7200
  )
    throw Error("UI allocation exceeds its bounded reuse class");
  if (!Number.isSafeInteger(factory.rust?.maxJobs) || factory.rust.maxJobs < 1 || factory.rust.maxJobs > 6)
    throw Error("Native allocation is unknown");
  for (const value of [capacity.availableMemoryGiB, capacity.availableDiskGiB, capacity.cores])
    if (!Number.isFinite(value) || value < 0) throw Error("Unknown factory capacity");
  if (
    capacity.availableMemoryGiB < ui.memoryGiB + ui.reserveMemoryGiB ||
    capacity.availableDiskGiB < ui.reserveDiskGiB + ui.scratchGiB ||
    capacity.cores < factory.rust.maxJobs + ui.cpus
  )
    throw Error("Insufficient capacity for UI alongside the declared native allocation");
  return ui;
}

export async function qualifyUiRuntime(configPath: string): Promise<UiAllocation> {
  if (process.platform !== "linux") throw Error("UI execution requires the qualified Linux factory");
  const factory = (await Bun.file(configPath).json()) as UiFactory;
  const memory = await Bun.file("/proc/meminfo").text();
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(memory)?.[1];
  if (!available) throw Error("Available host memory is unknown");
  const disk = statfsSync(factory.artifactRoot);
  const cpuRows = (await Bun.file("/proc/stat").text()).match(/^cpu\d+\s/gm);
  if (!cpuRows?.length) throw Error("Host CPU capacity is unknown");
  const ui = qualifyUiAllocation(factory, {
    availableMemoryGiB: Number(available) / 1048576,
    availableDiskGiB: (Number(disk.bavail) * Number(disk.bsize)) / 1073741824,
    cores: cpuRows.length,
  });
  if (!factoryLeaseHeld(ui.lockPath)) throw Error("The actual UI kernel lease is not held");
  const relative = (await Bun.file("/proc/self/cgroup").text())
    .trim()
    .split("\n")
    .find(line => line.startsWith("0::"))
    ?.slice(3);
  if (!relative?.startsWith("/") || posix.normalize(relative) !== relative) throw Error("The UI cgroup is unknown");
  const root = "/sys/fs/cgroup" + relative;
  const [memoryMax, swapMax, cpuMax] = await Promise.all(
    ["memory.max", "memory.swap.max", "cpu.max"].map(async name =>
      (await Bun.file(posix.join(root, name)).text()).trim(),
    ),
  );
  const [quota, period] = cpuMax!.split(/\s+/).map(Number);
  if (
    memoryMax !== String(ui.memoryGiB * 1073741824) ||
    swapMax !== "0" ||
    !Number.isFinite(quota) ||
    !Number.isFinite(period) ||
    quota! / period! !== ui.cpus
  )
    throw Error("The effective UI cgroup does not match the declared limits");
  return ui;
}

if (import.meta.main) {
  const [action, configPath] = Bun.argv.slice(2);
  if (action !== "qualify" || !configPath || Bun.argv.length !== 4)
    throw Error("Usage: build-factory-ui.ts qualify <canonical-factory-config>");
  const ui = await qualifyUiRuntime(configPath);
  console.log(
    JSON.stringify({
      schema: "aphrody.ui-allocation/1",
      qualified: true,
      ...ui,
    }),
  );
}
