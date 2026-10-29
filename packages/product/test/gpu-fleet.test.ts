// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { diskCommand } from "../src/admin/lib/fleet/disks.ts";
import { openPlanner } from "../src/admin/lib/fleet/native.ts";

test("a missing Python application owner is rejected before interpreter initialization", async () => {
  await expect(openPlanner(join(import.meta.dir, "missing-owner"))).rejects.toThrow("source missing");
});

test.skipIf(!process.env.BUN_PYTHON_HOST_LIBRARY || !existsSync(process.env.BUN_PYTHON_HOST_LIBRARY))(
  "real embedded Python uses this Bun process and preserves queued operations",
  async () => {
    // CPython is process-global: qualification uses the dedicated owner process,
    // not bun:test's process (which owns other tests and their thread lifecycle).
    const code = `import {openPlanner} from ${JSON.stringify(join(import.meta.dir, "../src/admin/lib/fleet/native.ts"))};
      await using py = await openPlanner(${JSON.stringify(join(import.meta.dir, "../../../py/packages/aphrody/src"))});
      const pid=Number(await py.eval('os.getpid()'));
      const values=await Promise.all([py.eval('40+2'),py.eval('40+3')]);
      console.log(JSON.stringify({sameProcess:pid===process.pid,values}));`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [out, errors, result] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ result, errors }).toEqual({ result: 0, errors: "" });
      expect(JSON.parse(out)).toEqual({
        sameProcess: true,
        values: ["42", "43"],
      });
    } finally {
      clearTimeout(deadline);
      child.kill();
    }
  },
  25_000,
);

test("reciprocal Explorer mounts use declared peers and protected host keys", () => {
  const argv = diskCommand("omar", "O:", "C:/Users/owner", "C:/Program Files");
  expect(argv).toContain("omara@10.200.77.10:/C:/");
  expect(argv).toContain("StrictHostKeyChecking=yes");
  expect(argv).toContain("IdentityFile=/cygdrive/c/Users/owner/.ssh/id_ed25519_aphrody");
  expect(diskCommand("aphro-pc", "P:", "C:/Users/omar", "C:/Program Files")).toContain("aphro@10.200.77.4:/C:/");
  expect(() => diskCommand("external", "O:", "C:/Users/owner", "C:/Program Files")).toThrow("undeclared");
  expect(() => diskCommand("omar", "C:", "C:/Users/owner", "C:/Program Files")).toThrow("unused");
});
