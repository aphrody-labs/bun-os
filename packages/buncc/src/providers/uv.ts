/** uv: Python package/project manager (the fork shipped it as the `bun uv` plugin). */
import { join } from "node:path";
import type { GithubToolSpec } from "./_github.ts";
import { toolProvider } from "./_tool.ts";

export const uvRelease: GithubToolSpec = {
  id: "uv",
  repo: "astral-sh/uv",
  binary: "uv",
  asset(_tag, platform, arch) {
    const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
    if (!cpu) return undefined;
    if (platform === "win32") return `uv-${cpu}-pc-windows-msvc.zip`;
    if (platform === "darwin") return `uv-${cpu}-apple-darwin.tar.gz`;
    return `uv-${cpu}-unknown-linux-gnu.tar.gz`;
  },
};

export const uvProvider = toolProvider({
  id: "uv",
  description: "uv Python package manager",
  binary: "uv",
  versionArgs: ["--version"],
  packages: { winget: "astral-sh.uv", pacman: "uv", dnf: "uv", apk: "uv", brew: "uv" },
  github: uvRelease,
  manual:
    "download uv with `ensure()` (checksum-verified release) or see https://docs.astral.sh/uv/getting-started/installation/",
});

export function uvSyncArgs(o: { frozen?: boolean; python?: string; groups?: string[] } = {}): string[] {
  const args = ["sync"];
  if (o.frozen) args.push("--frozen");
  if (o.python) args.push("--python", o.python);
  for (const g of o.groups ?? []) args.push("--group", g);
  return args;
}

export function uvRunArgs(command: string[], o: { python?: string; withPackages?: string[] } = {}): string[] {
  const args = ["run"];
  if (o.python) args.push("--python", o.python);
  for (const w of o.withPackages ?? []) args.push("--with", w);
  return [...args, "--", ...command];
}

export function venvPython(project: string, platform: string = process.platform): string {
  return platform === "win32"
    ? join(project, ".venv", "Scripts", "python.exe")
    : join(project, ".venv", "bin", "python");
}
