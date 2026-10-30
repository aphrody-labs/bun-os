// SPDX-License-Identifier: Apache-2.0
// Read-only test sections of the portable export contract guards.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkNoEscapingImports, checkPackageRuntimes, stripNonCode, type Offence } from "../src/guards";

const FIXTURES = join(import.meta.dir, "fixtures", "portability");
const summary = (offences: Offence[]) => offences.map(o => `${o.file} ${o.rule}`).toSorted();

describe("stripNonCode", () => {
  test("blanks comments and literal contents, keeps offsets and code", () => {
    const source =
      'const a = "process.env"; // Bun.env\nconst b = `x${process.env.Y}` + /node:fs/.source; /* dlopen() */';
    const code = stripNonCode(source);
    expect(code).toHaveLength(source.length);
    expect(code).not.toContain("Bun.env");
    expect(code).not.toContain("node:fs");
    expect(code).not.toContain("dlopen");
    expect(code.match(/process\.env/g)).toHaveLength(1);
    expect(code.split("\n")).toHaveLength(2);
  });
});

describe("checkPackageRuntimes", () => {
  test("clean fixture has no offence", async () => {
    expect(await checkPackageRuntimes(join(FIXTURES, "clean"))).toEqual([]);
  });

  test("violating fixture yields exactly one offence per rule", async () => {
    expect(summary(await checkPackageRuntimes(join(FIXTURES, "violating")))).toEqual(
      [
        "package.json missing-export-target",
        "package.json missing-runtime-class",
        "src/alias.ts app-alias",
        "src/aphrody-native.ts aphrody-native",
        "src/apps.ts apps-import",
        "src/bun-react.ts bun:react",
        "src/dlopen.ts dlopen",
        "src/ffi.ts bun-ffi",
        "src/module-env.ts module-env",
        "src/pure-bun-global.ts pure:bun-global",
        "src/pure-bun.ts pure:bun",
        "src/pure-dom.ts pure:dom",
        "src/pure-node.ts pure:node",
        "src/pure-process.ts pure:process",
        "src/pure-react.ts pure:react",
        "src/pure-server.ts pure:package-server",
        "src/react-node.ts react:node",
        "src/reflect.ts reflect-metadata",
        "src/aphrody.ts aphrody-discord",
        "src/server-bun.ts server:bun",
        "src/server-only.ts server-only",
        "src/server-react.ts server:react",
        "src/t3.ts t3-env",
        "src/tsyringe.ts tsyringe",
      ].toSorted(),
    );
  });
});

describe("checkNoEscapingImports", () => {
  test("clean fixture stays inside its package", async () => {
    expect(await checkNoEscapingImports(join(FIXTURES, "clean"))).toEqual([]);
  });
  test("relative escapes and the app alias are reported", async () => {
    expect(summary(await checkNoEscapingImports(join(FIXTURES, "violating")))).toEqual([
      "src/alias.ts app-alias",
      "src/apps.ts escaping-import",
      "src/escape.ts escaping-import",
    ]);
  });
});
