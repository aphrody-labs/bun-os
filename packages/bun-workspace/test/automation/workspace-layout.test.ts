// SPDX-License-Identifier: Apache-2.0
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedWorkspace, runWorkspaceLayout } from "../../src/automation/workspace-layout.ts";

const root = join(import.meta.dir, "../../../..");

test("physical applications and packages absent from admission are both reported", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "bunos-workspace-layout-"));
  const errors: string[] = [];
  const logger = spyOn(console, "error").mockImplementation(message => errors.push(String(message)));
  try {
    await Bun.write(join(fixture, "package.json"), JSON.stringify({ workspaces: ["packages/admitted"] }));
    for (const path of ["packages/admitted", "packages/unregistered", "apps/unregistered"]) {
      await mkdir(join(fixture, path), { recursive: true });
      await Bun.write(join(fixture, path, "package.json"), JSON.stringify({ name: path.replace("/", "-") }));
    }
    expect(await runWorkspaceLayout(["--root", fixture])).toBe(1);
    const report = errors.join("\n");
    expect(report).toContain("package manifest is not declared as a workspace: packages/unregistered");
    expect(report).toContain("package manifest is not declared as a workspace: apps/unregistered");
    expect(report).not.toContain("package manifest is not declared as a workspace: packages/admitted");
    expect(errors.join("\n").split("\n")).toHaveLength(2);
  } finally {
    logger.mockRestore();
    await rm(fixture, { recursive: true, force: true });
  }
});

test("product members are flat and no toolchain checkout supplies workspace members", () => {
  for (const path of ["packages/bun-workspace", "apps/m3-next-example", "packages/canvas"])
    expect(allowedWorkspace(root, path)).toBe(true);
  for (const path of [
    "m3/templates/base",
    "m3/packages/canvas",
    "drive/apps/example",
    "crates/tauri/aphrody-tauri-api",
    "packages/m3-next/examples/app",
    "../material/packages/app-ui",
    "tools/config",
    "../other/packages/x",
    "../bun/src",
    "../bun/packages/",
    "../bun/packages/../../outside",
    "../bun/packages/x/../../../outside",
    "../material/src",
    "../material/packages/",
    "../material/packages/../../outside",
    "../material/packages/x/../../../outside",
    "packages/../../outside",
    "packages/./x",
    "packages\\member",
    "toolchains/bun/packages/bun-types",
    "toolchains/bun/packages/x/../../outside",
  ])
    expect(allowedWorkspace(root, path)).toBe(false);
});
