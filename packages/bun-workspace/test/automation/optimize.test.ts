// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { yoloCliPath } from "../yolo-cli-path.ts";
import { optimizationPrompt } from "../../src/automation/optimize.ts";
import { withoutPath, writeBunCommand } from "./fixtures/bun-command.ts";

// `yolo optimize` is the only command line of this module.
const yolo = yoloCliPath;

test("requires a bounded task", () => {
  expect(() => optimizationPrompt("  ")).toThrow("bounded");
});

test("passes task literally to the owner CLI and preserves its failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-optimize-"));
  try {
    const capture = join(dir, "args.json");
    await writeBunCommand(
      dir,
      "aphrody",
      "await Bun.write(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))); process.exit(7);\n",
      { native: true },
    );
    const task = 'simplify $(touch /tmp/should-not-run) `echo unsafe` "quoted"';
    const child = Bun.spawn([process.execPath, yolo, "optimize", task], {
      windowsHide: true,
      env: { ...withoutPath(process.env), PATH: dir, CAPTURE: capture },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(7);
    const args = await Bun.file(capture).json();
    expect(args.slice(0, 2)).toEqual(["exec", "--cd"]);
    expect(args).toHaveLength(4);
    expect(args[3]).toEndWith(task);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("preview needs no owner executable", async () => {
  const child = Bun.spawn([process.execPath, yolo, "optimize", "--print", "deduplicate selected imports"], {
    windowsHide: true,
    env: { ...process.env, PATH: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toContain("deduplicate selected imports");
});
