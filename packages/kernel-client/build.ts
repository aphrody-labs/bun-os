// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const child = Bun.spawn(
  [process.execPath, resolve(root, "scripts/build-packages.ts"), "build", "--package", "kernel-client"],
  { cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit", windowsHide: true },
);
if ((await child.exited) !== 0) throw new Error("Root package build failed");
