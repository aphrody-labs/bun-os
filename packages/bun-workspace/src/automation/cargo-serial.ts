// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";

/** The serialized Cargo wrapper of an Aphrody checkout: cargo-serial.sh, or its Bun twin on Windows. */
export function cargoSerialPath(root: string): string {
  return join(root, "scripts", "aphrody", "build", "rust", process.platform === "win32" ? "cargo-serial.ts" : "cargo-serial.sh");
}

/** Command prefix that runs the serialized Cargo wrapper; append Cargo arguments. */
export function cargoSerialCommand(root: string): string[] {
  const wrapper = cargoSerialPath(root);
  return process.platform === "win32" ? [process.execPath, wrapper] : [wrapper];
}
