import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { boot } from "../src/boot.ts";

// Needs the container2wasm artifact (factory/wasmos/build-alpine.ts, or the CI artifact). Skipped without it:
// a boot is claimed only when its serial log exists.
const wasm = process.env.WASMOS_ALPINE_WASM ?? "";

test.skipIf(!wasm || !existsSync(wasm))(
  "Alpine x86_64 boots under Bun (Bochs + Linux in wasm) and reports kernel, uname and apk",
  async () => {
    const log = process.env.WASMOS_BOOT_LOG ?? "serial-bun.log";
    const r = await boot({
      wasm,
      args: ["sh", "-c", "dmesg | head -n 3; uname -a; apk --version; cat /etc/alpine-release"],
      timeoutMs: 900_000,
      logPath: log,
    });
    console.log(JSON.stringify({ ms: r.ms, exit: r.exitCode, timedOut: r.timedOut }));
    console.log(r.output);
    expect(r.timedOut).toBe(false);
    expect(r.output).toMatch(/Linux version 6\.\d+/); // kernel banner from dmesg
    expect(r.output).toMatch(/^Linux \S+ 6\.\d+\S* .* x86_64 Linux/m); // uname -a
    expect(r.output).toMatch(/apk-tools \d/);
    expect(r.output).toContain("3.24");
    expect(r.exitCode).toBe(0);
  },
  1_000_000,
);
