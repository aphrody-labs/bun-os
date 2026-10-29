/** uv: Python package/project manager (the fork shipped it as the `bun uv` plugin). */
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

