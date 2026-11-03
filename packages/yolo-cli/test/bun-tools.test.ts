import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBunTool } from "../src/bun-tools";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("devtools run in-process from the Bun OS plugin registry, never from a checkout package script", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yolo-bun-tools-"));
  temporary.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { rename: "bun -e \"Bun.write('probe-executed', 'unexpected')\"" } }),
  );
  expect(await runBunTool("rename", ["--help"], dir)).toBe(0);
  expect(existsSync(join(dir, "probe-executed"))).toBe(false);
});

test("parse reports a file of the working directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yolo-bun-parse-"));
  temporary.push(dir);
  writeFileSync(join(dir, "m.ts"), "export const answer = 42;\n");
  expect(await runBunTool("parse", ["m.ts"], dir)).toBe(0);
  expect(await runBunTool("parse", ["missing.ts"], dir)).toBe(1);
});
