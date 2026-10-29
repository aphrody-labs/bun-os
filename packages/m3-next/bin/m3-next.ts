#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Run Next.js 16 on Bun with no Node on the machine:
//
//   m3-next dev | build | start [next arguments]        (in the Aphrody checkout: yolo m3 next ...)
//
// The runner lives in @aphrody/next-bun (the former Bun fork, packages/bun-next): this Bun runs the app's `next` with a
// `node` that is Bun first on PATH, so Turbopack workers run on Bun too.
import { bunExecutable, bunNodeShim, nextBin, nextCommand, runNext } from "@aphrody/next-bun/run";

export { bunExecutable, bunNodeShim, nextBin, nextCommand };

/** `m3-next <argv>` (`yolo m3 next <argv>`): runs the app's Next and resolves to its exit status. */
export async function runM3Next(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(
      "usage: m3-next <dev|build|start|...> [next arguments]\nRuns the app's Next.js on Bun, Turbopack workers included.",
    );
    return argv.length === 0 ? 2 : 0;
  }
  return await runNext(argv);
}

if (import.meta.main) process.exit(await runM3Next(process.argv.slice(2)));
