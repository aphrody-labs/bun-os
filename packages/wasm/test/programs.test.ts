// Programs ported from the fork's AOT suite (test/aot/programs/webassembly): each runs under upstream Bun
// and its stdout must equal the recorded expectation. They exercise the engine's WebAssembly (imports,
// tables, memories, traps, SIMD vectors, `import x from "./a.wasm"`), not this package.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "programs");
const programs = readdirSync(dir)
  .filter(file => file.endsWith(".expected.txt"))
  .map(file => file.slice(0, -".expected.txt".length));

describe("webassembly programs on upstream Bun", () => {
  test("the corpus is present", () => {
    expect(programs.length).toBeGreaterThanOrEqual(8);
  });

  test.concurrent.each(programs)("%s", async name => {
    const proc = Bun.spawn([process.execPath, join(dir, name, "main.ts")], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BUN_JSC_crashIfInterpreterIsUsed: undefined },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const expected = readFileSync(join(dir, `${name}.expected.txt`), "utf8").replace(/\r\n/g, "\n");
    expect({ stdout: stdout.replace(/\r\n/g, "\n"), stderr, exitCode }).toEqual({
      stdout: expected,
      stderr: "",
      exitCode: 0,
    });
  });
});
