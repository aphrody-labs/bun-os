// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Python, PythonError, PyStatus } from "../src/python";

const qualified = Boolean(
  process.env.BUN_PYTHON_HOST_LIBRARY &&
  existsSync(process.env.BUN_PYTHON_HOST_LIBRARY) &&
  process.env.BUN_PYTHON_LIBPYTHON &&
  existsSync(process.env.BUN_PYTHON_LIBPYTHON),
);

test("opening without a Python host library reports a load error", () => {
  const saved = [process.env.BUV_PYTHON_HOST_LIBRARY, process.env.BUN_PYTHON_HOST_LIBRARY];
  delete process.env.BUV_PYTHON_HOST_LIBRARY;
  delete process.env.BUN_PYTHON_HOST_LIBRARY;
  try {
    expect(() => Python.open()).toThrow(/Python host unavailable|Cannot find|cannot open|not found/i);
  } finally {
    if (saved[0] !== undefined) process.env.BUV_PYTHON_HOST_LIBRARY = saved[0];
    if (saved[1] !== undefined) process.env.BUN_PYTHON_HOST_LIBRARY = saved[1];
  }
});

test.skipIf(!qualified)("the SDK drives the Python host through bun:ffi: eval, call, errors and disposal", () => {
  const python = Python.open();
  try {
    python.run("import os\ndef sdk_echo(value):\n    return value\n");
    expect(python.eval("os.getpid()")).toBe(String(process.pid));
    expect(python.call("__main__", "sdk_echo", "été 🐍")).toBe("été 🐍");
    try {
      python.run("raise ValueError('sdk-fixture')");
      throw new Error("Python exception was hidden");
    } catch (error) {
      expect(error).toBeInstanceOf(PythonError);
      expect((error as PythonError).status).toBe(PyStatus.Python);
    }
    expect(python.eval("2 + 2")).toBe("4");
  } finally {
    python.close();
  }
  expect(() => python.close()).not.toThrow();
  expect(() => python.eval("1")).toThrow("Python host handle is closed");
});

test.skipIf(!qualified)("PythonAsync serves the host from a worker", async () => {
  await using python = await Python.async();
  await python.exec("def twice(value):\n    return value * 2\n");
  expect(await python.eval("1 + 1")).toBe("2");
  expect(await python.call("__main__", "twice", "ab")).toBe("abab");
});
