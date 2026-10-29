import { delimiter } from "node:path";
import { expect, test } from "bun:test";
import { diffEnv, overlayEnv, parseEnvDump, sanitizeEnv } from "../src/env.ts";

const present = new Set(["/ok/protoc", "/ok/include", "/ok/inc2", "/ok/sccache"]);
const exists = (path: string) => present.has(path);
const which = (program: string) => (present.has(program) ? program : null);

test("stale single-path variables are dropped, valid ones kept", () => {
  const { env, dropped } = sanitizeEnv(
    { PROTOC: "/ok/protoc", PROTOC_INCLUDE: "/gone/include", PATH: "/x" },
    { exists, which, caseInsensitive: false },
  );
  expect(env.PROTOC).toBe("/ok/protoc");
  expect(env.PROTOC_INCLUDE).toBeUndefined();
  expect(env.PATH).toBe("/x");
  expect(dropped).toEqual([{ name: "PROTOC_INCLUDE", value: "/gone/include", reason: "path does not exist" }]);
});

test("list variables lose only the missing entries", () => {
  const { env, dropped } = sanitizeEnv(
    { INCLUDE: ["/ok/include", "/gone", "/ok/inc2"].join(delimiter), LIB: "/gone" },
    { exists, which, caseInsensitive: false },
  );
  expect(env.INCLUDE).toBe(["/ok/include", "/ok/inc2"].join(delimiter));
  expect(env.LIB).toBeUndefined();
  expect(dropped.map(entry => entry.value)).toEqual(["/gone", "/gone"]);
});

test("a crashing or removed RUSTC_WRAPPER program is dropped", () => {
  const kept = sanitizeEnv({ RUSTC_WRAPPER: "/ok/sccache" }, { exists, which, caseInsensitive: false });
  expect(kept.env.RUSTC_WRAPPER).toBe("/ok/sccache");
  const gone = sanitizeEnv({ RUSTC_WRAPPER: "sccache-missing", CC: "" }, { exists, which, caseInsensitive: false });
  expect(gone.env.RUSTC_WRAPPER).toBeUndefined();
  expect(gone.env.CC).toBeUndefined();
});

test("Windows variable names match case-insensitively", () => {
  const { env } = sanitizeEnv({ protoc_include: "/gone" }, { exists, which, caseInsensitive: true });
  expect(env.protoc_include).toBeUndefined();
});

test("set output parses and diffs against a base", () => {
  const dump = "PATH=C:\\a;C:\\b\r\nINCLUDE=C:\\inc\r\n=C:=C:\\x\r\nFOO=bar\r\n";
  const parsed = parseEnvDump(dump);
  expect(parsed).toEqual({ PATH: "C:\\a;C:\\b", INCLUDE: "C:\\inc", FOO: "bar" });
  expect(diffEnv({ Path: "C:\\a;C:\\b", FOO: "bar" }, parsed, true)).toEqual({ INCLUDE: "C:\\inc" });
});

test("overlay keeps the base casing and deletes on undefined", () => {
  const out = overlayEnv({ Path: "a", X: "1" }, { PATH: "b", X: undefined }, true);
  expect(out).toEqual({ Path: "b" });
});
