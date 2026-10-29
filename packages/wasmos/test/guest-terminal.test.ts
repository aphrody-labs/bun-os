// SPDX-License-Identifier: Apache-2.0
// End to end: a real command runs in the Alpine guest (Bochs + Linux in wasm) and its output is what Rio VT renders.
//
//   WASMOS_ALPINE_WASM  the container2wasm image (factory/wasmos/build-alpine.ts)
//   WASMOS_RIO_PKG      wasm-pack --target nodejs output of crates/aphrody-shell-web (WebTerminal on rio-vt)
//
// Skipped without both: a render is claimed only when the real guest and the real VT were used.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GuestTerminal, onlcr } from "../src/guest-terminal.ts";

const wasm = process.env.WASMOS_ALPINE_WASM ?? "";
const pkg = process.env.WASMOS_RIO_PKG ?? "";
const ready = !!wasm && existsSync(wasm) && !!pkg && existsSync(join(pkg, "aphrody_shell_web.js"));

test("onlcr turns bare line feeds into CR LF and leaves CR LF alone", () => {
  expect(new TextDecoder().decode(onlcr("a\nb\r\nc"))).toBe("a\r\nb\r\nc");
});

test.skipIf(!ready)(
  "uname and ls run in Alpine and Rio VT renders their output",
  async () => {
    const { WebTerminal } = await import(join(pkg, "aphrody_shell_web.js"));
    const vt = new WebTerminal(100, 30);
    const term = new GuestTerminal(vt, wasm);

    const uname = await term.run("uname -sm");
    expect(uname.exitCode).toBe(0);
    let screen = term.screen();
    expect(screen).toContain("$ uname -sm");
    expect(screen).toMatch(/^Linux x86_64\s*$/m);

    const ls = await term.run("ls /");
    expect(ls.exitCode).toBe(0);
    screen = term.screen();
    // Real Alpine root: these directories exist in every image; the lines are not staircased.
    for (const dir of ["bin", "etc", "usr"]) expect(screen).toMatch(new RegExp(`^${dir}\\s*$`, "m"));
    console.log(
      screen
        .split("\n")
        .filter(l => l.trim())
        .slice(0, 12)
        .join("\n"),
    );
  },
  600_000,
);
