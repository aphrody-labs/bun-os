import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  M3_TOOLS,
  PACKAGE_COMMANDS,
  type PackageRunner,
  isPackageCommand,
  packageRoot,
  resolvePackageCommand,
  runPackageCommand,
} from "../src/package-commands";

const root = resolve(import.meta.dir, "../../..");
const entry = join(root, "packages/yolo-cli/src/index.ts");
const fixture = mkdtempSync(join(tmpdir(), "yolo-package-commands-"));

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function owner(name: keyof typeof PACKAGE_COMMANDS, source: string): string {
  const fixtureRoot = join(fixture, name);
  const path = join(fixtureRoot, PACKAGE_COMMANDS[name].module);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  return fixtureRoot;
}

function yolo(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, entry, ...args], {
    windowsHide: true,
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("yolo package commands", () => {
  it("source runs use this checkout as the owner root", () => {
    expect(packageRoot()).toBe(root);
    expect(isPackageCommand("ops")).toBe(true);
    expect(isPackageCommand("toString")).toBe(false);
  });

  it("every command and tool has a qualified owner runner or standalone CLI", async () => {
    const runners: [string, PackageRunner][] = [
      ...Object.entries(PACKAGE_COMMANDS),
      ...Object.entries(M3_TOOLS).map(([tool, runner]): [string, PackageRunner] => [`m3 ${tool}`, runner]),
    ];
    for (const [name, { module, run, script }] of runners) {
      const path = join(root, module);
      expect(existsSync(path), `${name}: ${module}`).toBe(true);
      if (script) {
        const result = Bun.spawnSync([process.execPath, path, "--help"], {
          cwd: root,
          windowsHide: true,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toContain("aphrody-scaffold");
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- one owner module at a time keeps failures attributable.
      const loaded = (await import(path)) as Record<string, unknown>;
      expect(typeof loaded[run], `${name}: ${module} exports ${run}`).toBe("function");
    }
  });

  it("yolo m3 resolves a tool by its first argument and everything else to the framework CLI", async () => {
    // Resolution rule: a first argument naming a tool selects it; tool names never shadow an m3 framework command.
    const framework = (await import(join(root, PACKAGE_COMMANDS.m3.module))) as {
      COMMANDS: readonly string[];
    };
    for (const tool of Object.keys(M3_TOOLS)) expect(framework.COMMANDS).not.toContain(tool);
    const next = resolvePackageCommand("m3", ["next", "dev", "--port", "3001"]);
    expect(next).toMatchObject({
      label: "m3 next",
      module: M3_TOOLS.next.module,
      args: ["dev", "--port", "3001"],
    });
    for (const args of [[], ["dev"], ["new", "next"], ["--help"], ["toString"]]) {
      expect(resolvePackageCommand("m3", args)).toMatchObject({
        label: "m3",
        module: PACKAGE_COMMANDS.m3.module,
        args,
      });
    }
    expect(resolvePackageCommand("ops", ["next"])).toMatchObject({
      label: "ops",
      args: ["next"],
    });
    expect(resolvePackageCommand("ovh", [])).toBeUndefined();
  });

  it("servers and watchers keep the process alive; one-shot commands end it", () => {
    expect(resolvePackageCommand("m3", ["dev"])?.keepAlive).toBe(true);
    expect(resolvePackageCommand("m3", ["bun", "serve"])?.keepAlive).toBe(true);
    expect(resolvePackageCommand("m3", ["scaffold", "list"])?.keepAlive).toBeUndefined();
  });

  it("dispatches in-process with the literal arguments and returns the runner status", async () => {
    const fixtureRoot = owner(
      "update",
      "export function runUpdate(argv) { globalThis.yoloPackageArgs = argv; return 23; }\n",
    );
    const args = ["rust", "status", "--root", "/home/ubuntu/apps/repo", "$(literal)"];
    expect(await runPackageCommand("update", args, fixtureRoot)).toBe(23);
    expect((globalThis as { yoloPackageArgs?: unknown }).yoloPackageArgs).toEqual(args);
  });

  it("maps owner failures to exit statuses", async () => {
    const throwing = owner("doc-ai", "export async function main() { throw new Error('boom'); }\n");
    expect(await runPackageCommand("doc-ai", [], throwing)).toBe(1);
    const noExport = owner("google", "export const unrelated = 1;\n");
    expect(await runPackageCommand("google", [], noExport)).toBe(70);
    expect(await runPackageCommand("unknown", [], root)).toBe(2);
  });

  it("qualification uses the native SDK in process and closes it after the awaited owner", async () => {
    const fixtureRoot = join(fixture, "native-jobs-qualified");
    const modules: Record<string, string> = {
      [PACKAGE_COMMANDS.update.module]: `export async function runUpdate(argv, ports) {
        const result = await ports.nativeJobTransport({config:"private.toml", server:"aphrody", tool:"aphrody_job_status", arguments:{}}, {timeoutMs:15000});
        if (result.native !== true) throw new Error("wrong transport");
        return 19;
      }`,
      "packages/interop/native/src/pipeline.ts": `export async function mcpTool(request, options) {
        globalThis.yoloNativeJobRequest = {request, options};
        await Promise.resolve();
        return {native:true};
      }`,
      "packages/interop/native/src/engine.ts": `export function close() { globalThis.yoloNativeJobClosed = true; }`,
    };
    for (const [path, source] of Object.entries(modules)) {
      mkdirSync(dirname(join(fixtureRoot, path)), { recursive: true });
      writeFileSync(join(fixtureRoot, path), source);
    }
    expect(
      await runPackageCommand(
        "update",
        ["--root", fixtureRoot, "systemd", "jobs-clients", "--qualify", "--apply"],
        fixtureRoot,
      ),
    ).toBe(19);
    expect((globalThis as { yoloNativeJobRequest?: unknown }).yoloNativeJobRequest).toEqual({
      request: {
        config: "private.toml",
        server: "aphrody",
        tool: "aphrody_job_status",
        arguments: {},
      },
      options: { timeoutMs: 15000 },
    });
    expect((globalThis as { yoloNativeJobClosed?: boolean }).yoloNativeJobClosed).toBe(true);
  });

  it("a dry-run qualification does not load the native library", async () => {
    const fixtureRoot = join(fixture, "native-jobs-dry-run");
    const path = join(fixtureRoot, PACKAGE_COMMANDS.update.module);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      "export function runUpdate(argv, ports) { if (ports !== undefined) throw new Error('native loaded during preview'); return 0; }",
    );
    expect(await runPackageCommand("update", ["systemd", "jobs-clients", "--qualify"], fixtureRoot)).toBe(0);
  });

  it("the CLI entry routes each command to its owner", () => {
    const cases: [string[], string][] = [
      [["optimize", "--print", "--", "deduplicate selected imports"], "deduplicate selected imports"],
      [["workspace", "--help"], "code-edit <operation>"],
      [["ops", "iecode-doctor", "--help"], "Usage: yolo ops iecode-doctor"],
      [["update", "help"], "yolo update check"],
      [["google", "--help"], "yolo google <drive|fonts>"],
      [["doc-ai", "--help"], "yolo doc-ai translate"],
      [["m3", "--help"], "Tools (yolo m3 <tool> ...):"],
      [["m3", "help"], "m3 new <dir>"],
      [["m3", "next", "--help"], "usage: m3-next"],
      [["m3", "bun", "help"], "m3-bun dev"],
      [["m3", "os-themes"], "m3-os-themes <install|generate|uninstall>"],
      [["m3", "next-migrate", "--help"], "next-migrate [OPTIONS]"],
      [["m3", "web-to-tauri", "help"], "web-to-tauri probe"],
      [["m3", "scaffold", "list"], "example"],
    ];
    for (const [args, expected] of cases) {
      const result = yolo(...args);
      expect(result.status, `${args.join(" ")}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(expected);
    }
  });

  it("the CLI entry keeps owner exit statuses and leaves Rust-owned commands to aphrody", () => {
    const google = yolo("google", "models");
    expect(google.status).toBe(2);
    expect(google.stderr).toContain("aphrody google models");
    expect(isPackageCommand("ovh")).toBe(false);
    expect(yolo("update", "no-such-module").status).toBe(2);
    const icons = yolo("m3", "svg-to-ico");
    expect(icons.status).toBe(2);
    expect(icons.stderr).toContain("usage: svg-to-ico");
    const m3 = yolo("m3", "no-such-command");
    expect(m3.status).toBe(1);
    expect(m3.stderr).toContain("yolo m3: unknown command no-such-command");
  });
});
