/** just: command runner (the fork shipped it as the `bun just` plugin). */
import type { GithubToolSpec } from "./_github.ts";
import { toolProvider } from "./_tool.ts";

export const justRelease: GithubToolSpec = {
  id: "just",
  repo: "casey/just",
  binary: "just",
  asset(tag, platform, arch) {
    const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
    if (!cpu) return undefined;
    if (platform === "win32") return `just-${tag}-${cpu}-pc-windows-msvc.zip`;
    if (platform === "darwin") return `just-${tag}-${cpu}-apple-darwin.tar.gz`;
    return `just-${tag}-${cpu}-unknown-linux-musl.tar.gz`;
  },
};

export const justProvider = toolProvider({
  id: "just",
  description: "just command runner",
  binary: "just",
  versionArgs: ["--version"],
  packages: { winget: "Casey.Just", pacman: "just", apt: "just", dnf: "just", apk: "just", brew: "just" },
  github: justRelease,
});

export function justArgs(o: {
  justfile?: string;
  dir?: string;
  recipe?: string[];
  set?: Record<string, string>;
}): string[] {
  const args: string[] = [];
  if (o.justfile) args.push("--justfile", o.justfile);
  if (o.dir) args.push("--working-directory", o.dir);
  for (const [k, v] of Object.entries(o.set ?? {})) args.push("--set", k, v);
  return [...args, ...(o.recipe ?? [])];
}
