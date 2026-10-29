// SPDX-License-Identifier: Apache-2.0
// Worker side of PythonAsync: owns one Python host handle and serves its requests in order.
import { Python, PythonError } from "./python";

let python: Python | undefined;

self.onmessage = ({ data: { id, operation, args } }: MessageEvent<{ id: number; operation: string; args: any[] }>) => {
  try {
    let value: string | undefined;
    if (operation === "open") python = Python.open(args[0]);
    else if (!python) throw new Error("Python worker is not open");
    else if (operation === "close") {
      python.close();
      python = undefined;
    } else if (operation === "version") value = python.version();
    else if (operation === "run") python.run(args[0]);
    else if (operation === "eval") value = python.eval(args[0]);
    else if (operation === "call") value = python.call(args[0], args[1], args[2]);
    else throw new Error("Unknown Python worker operation");
    self.postMessage({ id, value });
  } catch (error) {
    self.postMessage({
      id,
      error: { status: error instanceof PythonError ? error.status : -3, message: String((error as Error).message ?? error) },
    });
  }
};
