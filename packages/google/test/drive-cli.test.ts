// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runDriveCli } from "../src/drive-cli";

const bunExe = () => process.execPath;
const bunEnv = { ...process.env } as Record<string, string>;

test("Drive sync help returns before option validation or credential access", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    await runDriveCli(["sync", "--help", "--seed-reviewed"]);
    await runDriveCli(["sync", "-h", "--legacy-bidirectional"]);
  } finally {
    console.log = original;
  }
  expect(lines).toEqual([
    expect.stringContaining("Usage: yolo google drive "),
    expect.stringContaining("Usage: yolo google drive "),
  ]);
});

test("standalone Google CLI dispatches Drive help without reading credentials", async () => {
  const child = Bun.spawn([bunExe(), resolve(import.meta.dir, "../src/cli.ts"), "drive", "--help"], {
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stdout).toContain("Usage: yolo google drive ");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
