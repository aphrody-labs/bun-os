#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Verifies the per-user Bun OS shell integration on this machine: enable -> assert -> undo ->
// assert clean -> (optionally) re-enable. Prints one JSON report. Needs `bunos-shell install` first.
//   bun factory/windows/shell/verify.ts [--keep component,...]
import { existsSync } from "node:fs";
import { join } from "node:path";

const tool = join(import.meta.dir, "bunos-shell.ts");
const bin = join(process.env.SystemRoot ?? "C:\\Windows", "BunOS", "bin");
const win = join(bin, "win.exe");
const keepArg = process.argv.indexOf("--keep");
const keep = keepArg > 0 ? process.argv[keepArg + 1].split(",") : [];

const sh = (cmd: string[]) => {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
};
const call = (t: string, args: object) => {
  const r = sh([win, "call", t, JSON.stringify(args), "--raw"]);
  return r.code === 0 ? JSON.parse(r.out) : null;
};
const reg = (path: string, name: string) => call("get_registry_value", { path, name })?.Value ?? null;
const keyExists = (path: string) => call("list_registry_key", { path }) !== null;

const C = "HKCU\\Software\\Classes";
const checks = () => ({
  nuAssoc: reg(`${C}\\.nu`, "(default)") === "BunOS.NuScript",
  shAssoc: reg(`${C}\\.sh`, "(default)") === "BunOS.ShScript",
  rioVerb: keyExists(`${C}\\Directory\\Background\\shell\\BunOS.Rio\\command`),
  filesVerb: keyExists(`${C}\\Directory\\shell\\BunOS.CosmicFiles\\command`),
  filesApp: keyExists(`${C}\\Applications\\cosmic-files.exe`),
  navpane: keyExists("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace\\{b05e05de-5a3e-4b1d-9a10-7b0f5a3e1102}"),
  wmAutostart: reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "BunOS.Desktop") !== null,
  wtFragment: existsSync(join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows Terminal", "Fragments", "BunOS", "bunos.json")),
  nuPlugin: sh([join(bin, "nu.exe"), "-c", "plugin list | where name == windows | length"]).out === "1",
  pluginCall: sh([join(bin, "nu.exe"), "-c", "plugin use windows; win shell-drives | length"]).out !== "",
  openWithNu: call("shell_open_with", { extension: ".nu", action: "default" })?.default ?? null,
});

const report: Record<string, unknown> = {};
report.enable = sh(["bun", tool, "enable"]).out.split("\n");
report.enabled = checks();
report.undo = sh(["bun", tool, "undo"]).out.split("\n");
report.afterUndo = checks();
if (keep.length) {
  report.reenable = sh(["bun", tool, "enable", ...keep]).out.split("\n");
  report.final = checks();
}
console.log(JSON.stringify(report, null, 2));
