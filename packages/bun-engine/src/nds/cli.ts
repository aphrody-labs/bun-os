import { join } from "node:path";
import { findEngine, findRoot } from "@bun-os/re/pipeline";

const root = findRoot(import.meta.dir) ?? join(import.meta.dir, "..", "..", "..", "..");
const cargoSerial = join(root, "scripts", "aphrody", "build", "rust", "cargo-serial.ts");

/** Runs the native `bun-engine` CLI (cartridge inspection, machines); builds it through Bun's
 * serialized MSVC owner when no installed binary exists. */
export async function runNative(args: string[]): Promise<number> {
  const native = await findEngine();
  if (native)
    return Bun.spawn([native, ...args], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).exited;
  const child = Bun.spawn(
    [process.execPath, cargoSerial, "--msvc", "run", "-q", "-p", "bun-engine", "--bin", "bun-engine", "--", ...args],
    {
      cwd: root,
      env: { ...process.env, RUSTC_BOOTSTRAP: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return await child.exited;
}
