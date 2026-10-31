// SPDX-License-Identifier: MIT
// bun:obscura of the aphrody-labs/bun fork: the shared Chromium engine behind the Obscura name.
import chromium, { connect } from "./chromium.ts";

export function findExecutable(): string | null {
  return chromium.findExecutable();
}

type LaunchOptions = import("bun:chromium").LaunchOptions & { workers?: number };

export async function launch(options: LaunchOptions = {}) {
  const workers = options.workers ?? 1;
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 64)
    throw new RangeError("workers must be an integer from 1 to 64");
  if (workers !== 1) throw new RangeError("Shared Chromium Obscura supports one browser worker");
  options.signal?.throwIfAborted();
  const executable = options.executable ?? findExecutable();
  if (!executable) throw new Error("Chromium executable not found; set BUN_CHROMIUM_PATH");
  const browser = await chromium.launch({ ...options, executable });
  return { ...browser, engine: "chromium" as const };
}

export { connect };
export default { connect, findExecutable, launch };
