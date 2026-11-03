// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, writeFiles } from "../src/cli.ts";
import { BUNOS_THEME } from "../src/apps.ts";
import { generate } from "../src/generate.ts";

test("theme inputs and generated output reject invalid modes, variants and escaping paths", async () => {
  expect(run(["generate", "--seed", "--apply"]).code).toBe(2);
  expect(run(["generate", "--variant", "unknown"]).code).toBe(2);
  expect(() => generate({ ...BUNOS_THEME, mode: "invalid" as never })).toThrow("mode");
  const root = mkdtempSync(join(tmpdir(), "m3-path-boundary-"));
  const outside = mkdtempSync(join(tmpdir(), "m3-path-outside-"));
  try {
    expect(() => writeFiles([{ target: "gnome", path: "../escape", content: "bad" }], root)).toThrow("escapes");
    if (process.platform !== "win32") {
      symlinkSync(outside, join(root, "link"), "dir");
      expect(() => writeFiles([{ target: "gnome", path: "link/private", content: "bad" }], root)).toThrow("symlink");
      expect(await Bun.file(join(outside, "private")).exists()).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")(
  "GNOME and COSMIC installers restore existing icon directories and preserve literal settings",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "m3-theme-integrity-"));
    try {
      const out = join(root, "out");
      const data = join(root, "data");
      const conf = join(root, "conf");
      const bin = join(root, "bin");
      const settingsLog = join(root, "settings.log");
      const marker = join(root, "must-not-exist");
      const icons = join(root, "Fixture Icons");
      const installed = join(data, "icons/Fixture Icons");
      mkdirSync(bin);
      mkdirSync(icons);
      mkdirSync(installed, { recursive: true });
      await Bun.write(join(icons, "index.theme"), "[Icon Theme]\nName=Fixture Icons\n");
      await Bun.write(join(icons, "new.svg"), "<svg>new</svg>");
      await Bun.write(join(installed, "original.svg"), "<svg>original</svg>");
      writeFileSync(
        join(bin, "gsettings"),
        '#!/usr/bin/env bash\ncase "$1" in\nget) printf "%s\\n" "$M3_FAKE_THEME" ;;\nwritable) printf "true\\n" ;;\nlist-schemas) printf "org.gnome.shell.extensions.user-theme\\n" ;;\nset) printf "%s\\n" "$4" >> "$M3_SETTINGS_LOG" ;;\nesac\n',
        { mode: 0o755 },
      );
      const literalSetting = '"$(touch ' + marker + ')"';
      const env = {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        XDG_DATA_HOME: data,
        XDG_CONFIG_HOME: conf,
        M3_SETTINGS_LOG: settingsLog,
        M3_FAKE_THEME: literalSetting,
      };
      /* oxlint-disable no-await-in-loop -- the installer steps mutate one sandbox and must run in order */
      for (const target of ["gnome", "cosmic"] as const) {
        expect(run(["generate", "--target", target, "--out", out]).code).toBe(0);
        const command = (...args: string[]) =>
          Bun.spawnSync(["bash", join(out, target, "install-" + target + ".sh"), ...args], {
            windowsHide: true,
            env,
            stdout: "pipe",
            stderr: "pipe",
          });
        const beforeInvalid = command("--icons", join(root, "missing"));
        expect(beforeInvalid.exitCode).toBe(2);
        expect(await Bun.file(join(installed, "original.svg")).text()).toBe("<svg>original</svg>");
        const apply = command("--mode", "dark", "--icons", icons);
        expect(apply.stderr.toString()).toBe("");
        expect(apply.exitCode).toBe(0);
        expect(await Bun.file(join(installed, "new.svg")).text()).toBe("<svg>new</svg>");
        expect(await Bun.file(join(installed, "original.svg")).exists()).toBe(false);
        expect(command("--mode", "dark", "--icons", icons).exitCode).toBe(0);
        expect(command("--uninstall").exitCode).toBe(0);
        expect(await Bun.file(join(installed, "original.svg")).text()).toBe("<svg>original</svg>");
        expect(await Bun.file(join(installed, "new.svg")).exists()).toBe(false);
        expect(await Bun.file(marker).exists()).toBe(false);
      }
      expect(await Bun.file(settingsLog).text()).toContain(literalSetting);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  10_000,
);
