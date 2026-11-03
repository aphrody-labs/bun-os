// SPDX-License-Identifier: MIT
// The fork's hardcoded npm builtins as Bun OS fallback modules: resolved when no package of that name is installed.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pack, unpack } from "../src/thirdparty/erlpack.ts";
import { parse } from "../src/thirdparty/dotenv.ts";
import { v4, v5, validate, version } from "../src/thirdparty/uuid.ts";

test("uuid, dotenv and erlpack keep their npm behaviour", () => {
  expect(validate(v4())).toBe(true);
  expect(v5("bun.sh", v5.DNS)).toBe(v5("bun.sh", v5.DNS));
  expect(version(v5("bun.sh", v5.DNS))).toBe(5);
  expect(parse("A=1\n# c\nB='two words'\nexport C=\"x\ny\"")).toEqual({ A: "1", B: "two words", C: "x\ny" });
  expect(unpack(pack({ list: [1, -2, 3.5, "s", true, null] }))).toEqual({ list: [1, -2, 3.5, "s", true, null] });
});

test("outside a project with those packages, the bare specifiers resolve to the fallbacks", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunos-thirdparty-"));
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(
    join(dir, "main.ts"),
    [
      'import { v7, validate } from "uuid";',
      'import pc, { red } from "picocolors";',
      'import invariant from "tiny-invariant";',
      'import { Inflate } from "zlib-sync";',
      'import { deflateSync } from "node:zlib";',
      "const inflate = new Inflate();",
      'inflate.push(deflateSync("hello"), 2);',
      "let message = '';",
      "try { invariant(false, 'boom'); } catch (e) { message = (e as Error).message; }",
      "console.log(JSON.stringify([validate(v7()), typeof red, typeof pc.createColors, String(inflate.result), message]));",
    ].join("\n"),
  );
  const preload = join(import.meta.dir, "..", "src", "preload.ts");
  const proc = Bun.spawnSync([process.execPath, "--preload", preload, "main.ts"], {
    cwd: dir,
    env: { ...process.env, BUN_OS_PLUGINS_STRICT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(proc.stderr.toString()).toBe("");
  expect(JSON.parse(proc.stdout.toString())).toEqual([true, "function", "function", "hello", "Invariant failed: boom"]);
});
