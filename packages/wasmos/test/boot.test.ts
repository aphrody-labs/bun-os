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

// Real pinned Alpine apps (factory/wasmos/pins.json "apps"), built by `bun factory/wasmos/build-alpine.ts --apps tools|lang`.
// Each assertion is the output of the real program (hash, JSON query, arithmetic, version of the pinned package).
const toolsWasm = process.env.WASMOS_TOOLS_WASM ?? "";
const langWasm = process.env.WASMOS_LANG_WASM ?? "";

async function run(wasm: string, script: string) {
  const r = await boot({ wasm, args: ["sh", "-c", script], timeoutMs: 900_000 });
  console.log(
    JSON.stringify({ wasm: wasm.split(/[\/]/).pop(), bytes: Bun.file(wasm).size, ms: r.ms, exit: r.exitCode }),
  );
  expect(r.timedOut).toBe(false);
  expect(r.exitCode).toBe(0);
  return r.output;
}

test.skipIf(!toolsWasm || !existsSync(toolsWasm))(
  "tools image runs uutils, bash, nushell, jq, ripgrep, fd, eza, git, curl, htop and vim",
  async () => {
    const out = await run(
      toolsWasm,
      [
        "printf abc | uutils sha256sum",
        "bash -c 'echo bash=$BASH_VERSINFO'",
        "nu -c '[1 2 3] | math sum'",
        `echo '{"a":[1,2]}' | jq -cM '.a|add'`,
        "printf 'foo\nbar\n' | rg --color never bar",
        "fd --version",
        "eza --version | sed -n 2p",
        "git --version",
        "curl --version | head -n 1",
        "htop --version",
        "vim --version | head -n 1",
      ].join("; "),
    );
    expect(out).toContain("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(out).toContain("bash=5");
    expect(out).toMatch(/^6$/m);
    expect(out).toMatch(/^3$/m);
    expect(out).toMatch(/^bar$/m);
    expect(out).toContain("fd 10.2.0");
    expect(out).toContain("v0.23.4");
    expect(out).toContain("git version 2.54.0");
    expect(out).toContain("curl 8.23.0");
    expect(out).toContain("htop 3.5.3");
    expect(out).toContain("VIM - Vi IMproved 9.2");
  },
  1_000_000,
);

test.skipIf(!langWasm || !existsSync(langWasm))(
  "lang image runs python3, helix and nano",
  async () => {
    const out = await run(
      langWasm,
      [
        `python3 -c 'import sys,hashlib; print(sys.version_info[:2], hashlib.sha256(b"abc").hexdigest())'`,
        "hx --version",
        "nano --version | head -n 1",
      ].join("; "),
    );
    expect(out).toContain("(3, 14) ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(out).toContain("helix 25.07.1");
    expect(out).toContain("GNU nano, version 9.3");
  },
  1_000_000,
);
