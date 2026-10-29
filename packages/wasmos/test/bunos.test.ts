import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { boot } from "../src/boot.ts";

// The Bun OS Alpine core image (factory/alpine/images/base.Dockerfile) converted by container2wasm:
// the Rust userland and Bun run inside Bochs inside wasm. Needs the artifact; skipped without it.
const wasm = process.env.WASMOS_BUNOS_WASM ?? "";

test.skipIf(!wasm || !existsSync(wasm))(
  "Bun OS Alpine core boots and runs uutils, sudo-rs, Bun and the bunos dispatcher",
  async () => {
    const r = await boot({
      wasm,
      args: [
        "sh",
        "-c",
        [
          "cat /etc/bunos-release",
          "cat --version | head -n 1",
          "sudo --version | head -n 1",
          "bun --version",
          `bun -e 'console.log(6*7)'`,
          `echo 'console.log("dispatch ok")' > /tmp/a.ts && bunos run /tmp/a.ts`,
        ].join("; "),
      ],
      timeoutMs: 1_500_000,
      logPath: process.env.WASMOS_BOOT_LOG ?? "serial-bunos.log",
    });
    console.log(JSON.stringify({ bytes: Bun.file(wasm).size, ms: r.ms, exit: r.exitCode, timedOut: r.timedOut }));
    console.log(r.output);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain("bunos-alpine");
    expect(r.output).toContain("uutils coreutils");
    expect(r.output).toContain("sudo-rs");
    expect(r.output).toContain("1.4.4-canary.20261028");
    expect(r.output).toMatch(/^42$/m);
    expect(r.output).toContain("dispatch ok");
    expect(r.exitCode).toBe(0);
  },
  1_600_000,
);
