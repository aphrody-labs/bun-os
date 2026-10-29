import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function isolatedDispatcher(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-ops-isolation-"));
  try {
    await copyFile(join(import.meta.dir, "ops.ts"), join(directory, "ops.ts"));
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function dispatch(directory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, join(directory, "ops.ts"), ...args], {
    windowsHide: true,
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, status };
}

test("IECODE doctor help loads without other operations or installed dependencies", async () => {
  await isolatedDispatcher(async directory => {
    await copyFile(join(import.meta.dir, "iecode-doctor.ts"), join(directory, "iecode-doctor.ts"));
    expect((await readdir(directory)).toSorted()).toEqual(["iecode-doctor.ts", "ops.ts"]);
    const result = await dispatch(directory, "iecode-doctor", "--help");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: yolo ops iecode-doctor");
  });
});

test("the selected operation receives arguments and preserves its exit status", async () => {
  await isolatedDispatcher(async directory => {
    await writeFile(
      join(directory, "web-migration.ts"),
      "export async function runWebMigration(args: string[]) { console.log(JSON.stringify(args)); return 23; }\n",
    );
    expect((await readdir(directory)).toSorted()).toEqual(["ops.ts", "web-migration.ts"]);
    const result = await dispatch(directory, "web-migration", "literal argument", "--example");
    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(["literal argument", "--example"]);
  });
});
