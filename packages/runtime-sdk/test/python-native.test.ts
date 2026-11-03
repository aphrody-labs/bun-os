// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { findLibpython, Python, PythonError, PyStatus } from "../src/python";

const qualified = Boolean(
  process.env.BUN_PYTHON_HOST_LIBRARY &&
  existsSync(process.env.BUN_PYTHON_HOST_LIBRARY) &&
  process.env.BUN_PYTHON_LIBPYTHON &&
  existsSync(process.env.BUN_PYTHON_LIBPYTHON),
);
const libpython = findLibpython();

test("the host backend without a Python host library reports a load error", () => {
  const saved = [process.env.BUV_PYTHON_HOST_LIBRARY, process.env.BUN_PYTHON_HOST_LIBRARY];
  delete process.env.BUV_PYTHON_HOST_LIBRARY;
  delete process.env.BUN_PYTHON_HOST_LIBRARY;
  try {
    expect(() => Python.open({ backend: "host" })).toThrow(
      /Python host unavailable|Cannot find|cannot open|not found/i,
    );
  } finally {
    if (saved[0] !== undefined) process.env.BUV_PYTHON_HOST_LIBRARY = saved[0];
    if (saved[1] !== undefined) process.env.BUN_PYTHON_HOST_LIBRARY = saved[1];
  }
});

test("the C API backend without a libpython reports a load error", () => {
  const saved = process.env.BUN_PYTHON_LIBPYTHON;
  process.env.BUN_PYTHON_LIBPYTHON = "/nonexistent/libpython3.99.so";
  try {
    expect(() => Python.open({ backend: "capi" })).toThrow();
  } finally {
    if (saved === undefined) delete process.env.BUN_PYTHON_LIBPYTHON;
    else process.env.BUN_PYTHON_LIBPYTHON = saved;
  }
});

function exercise(python: Python) {
  python.run("import os\ndef sdk_echo(value):\n    return value\nsdk_buffer = bytearray(b'abc')\n");
  expect(python.eval("os.getpid()")).toBe(String(process.pid));
  expect(python.call("__main__", "sdk_echo", "été 🐍")).toBe("été 🐍");
  expect(python.evalJSON<{ a: number[] }>("{'a': [1, 2]}")).toEqual({ a: [1, 2] });
  expect(python.evalBatch(["1 + 1", "'x' * 3"])).toEqual(["2", "xxx"]);
  try {
    python.run("raise ValueError('sdk-fixture')");
    throw new Error("Python exception was hidden");
  } catch (error) {
    expect(error).toBeInstanceOf(PythonError);
    expect((error as PythonError).status).toBe(PyStatus.Python);
    expect((error as PythonError).message).toContain("sdk-fixture");
  }
  const shared = new Uint8Array(python.buffer("sdk_buffer"));
  shared[0] = 0x7a;
  expect(python.eval("bytes(sdk_buffer)")).toBe("b'zbc'");
  expect(() => python.buffer("b'read-only'")).toThrow(PythonError);
  expect(python.eval("2 + 2")).toBe("4");
}

test.skipIf(libpython === null)("the C API backend drives a stock CPython through bun:ffi", () => {
  const python = Python.open({ backend: "capi" });
  try {
    expect(python.backend).toBe("capi");
    expect(python.version()).toMatch(/^3\.\d+/);
    exercise(python);
  } finally {
    python.close();
  }
  expect(() => python.close()).not.toThrow();
  expect(() => python.eval("1")).toThrow("Python host handle is closed");
});

test.skipIf(libpython === null)("PythonAsync shares the interpreter from a worker thread", async () => {
  const main = Python.open({ backend: "capi" });
  try {
    await using python = await Python.async({ backend: "capi" });
    await python.exec("def twice(value):\n    return value * 2\n");
    expect(await python.eval("1 + 1")).toBe("2");
    expect(await python.call("__main__", "twice", "ab")).toBe("abab");
    expect(main.eval("twice('x')")).toBe("xx");
  } finally {
    main.close();
  }
});

test.skipIf(!qualified)("the host backend drives the Python host through bun:ffi", () => {
  const python = Python.open({ backend: "host" });
  try {
    exercise(python);
  } finally {
    python.close();
  }
});

test.skipIf(libpython === null)("bun:python resolves through the Bun OS plugin", async () => {
  const { registerAll } = await import("@aphrody/bun-os-plugins");
  registerAll();
  Bun.plugin((await import("../src/bun-plugin")).default);
  const mod = (await import("bun:python" as string)) as typeof import("../src/python");
  expect(mod.Python).toBe(Python);
  expect(mod.default.Python).toBe(Python);
});
