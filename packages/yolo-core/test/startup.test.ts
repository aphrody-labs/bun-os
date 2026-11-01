import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectPackages } from "../src/vendor/status";
import { isCompiled } from "../src/vfs/home";
import { SUPPORTED_TARGETS, hostTarget } from "@aphrody/runtime-sdk/artifact";
import { hostTarget as leafHostTarget } from "@aphrody/runtime-sdk/target";
import { COMPILE_FLAGS } from "../../../scripts/aphrody/release/compile-flags";

const cli = resolve(import.meta.dir, "../../yolo-cli/src/index.ts");

describe("CLI start-up", () => {
  it("version prints the same line and JSON through the lazy entry", () => {
    const text = Bun.spawnSync([process.execPath, cli, "version"], {
      windowsHide: true,
      stdout: "pipe",
    }).stdout.toString();
    expect(text).toMatch(/^yolo \S+ \(\S+, Bun \S+\)\n$/);
    const json = JSON.parse(
      Bun.spawnSync([process.execPath, cli, "version", "--json"], {
        windowsHide: true,
        stdout: "pipe",
      }).stdout.toString(),
    );
    expect(json.schema).toBe("yolo.version/1");
    expect(json.target).toBe(hostTarget());
    expect(json.bunVersion).toBe(Bun.version);
  });

  it("an unknown command still prints the help and exits 1", () => {
    const run = Bun.spawnSync([process.execPath, cli, "no-such-command"], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("Unknown command: no-such-command");
    expect(run.stdout.toString()).toContain("YOLO Industrial Engine CLI");
  });

  it("hostTarget is shared by the leaf module and artifact", () => {
    expect(leafHostTarget).toBe(hostTarget);
    expect(Object.values(SUPPORTED_TARGETS)).toContain(hostTarget());
  });

  it("the source run is not the compiled executable", () => {
    expect(isCompiled()).toBe(false);
  });

  it("release compiles with a bytecode cache and without cwd autoloads", () => {
    expect(COMPILE_FLAGS).toEqual([
      "--bytecode",
      "--format=esm",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
    ]);
  });
});

describe("status file counts", () => {
  it("counts regular files, skips dot entries and stops past 250", async () => {
    const vendor = mkdtempSync(join(tmpdir(), "yolo-vendor-"));
    try {
      mkdirSync(join(vendor, "create-tauri-app/src/deep"), { recursive: true });
      mkdirSync(join(vendor, "create-tauri-app/.git"), { recursive: true });
      for (const file of ["a.rs", "src/b.rs", "src/deep/c.rs", ".hidden", ".git/HEAD"]) {
        writeFileSync(join(vendor, "create-tauri-app", file), "x");
      }
      mkdirSync(join(vendor, "plugins-workspace/src"), { recursive: true });
      for (let i = 0; i < 300; i++) writeFileSync(join(vendor, "plugins-workspace/src", `f${i}.rs`), "x");
      const byName = new Map((await inspectPackages(vendor)).map(p => [p.name, p]));
      expect(byName.get("create-tauri-app")?.filesCount).toBe(3);
      expect(byName.get("plugins-workspace")?.filesCount).toBe(251);
      expect(byName.has("bun")).toBe(false);
    } finally {
      rmSync(vendor, { recursive: true, force: true });
    }
  });
});
