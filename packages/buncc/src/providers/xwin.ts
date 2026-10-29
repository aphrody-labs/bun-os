/**
 * xwin (https://github.com/Jake-Shadle/xwin): detects and installs the tool binary only. buncc never runs `xwin splat` and
 * never passes `--accept-license`: the sysroot downloads Microsoft-licensed files, so the owner runs `xwin splat` himself.
 */
import type { GithubToolSpec } from "./_github.ts";
import { toolProvider } from "./_tool.ts";

export const xwinRelease: GithubToolSpec = {
  id: "xwin",
  repo: "Jake-Shadle/xwin",
  binary: "xwin",
  asset(tag, platform, arch) {
    const v = tag.replace(/^v/, "");
    const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
    if (!cpu) return undefined;
    if (platform === "win32") return arch === "x64" ? `xwin-${v}-x86_64-pc-windows-msvc.tar.gz` : undefined;
    if (platform === "linux") return `xwin-${v}-${cpu}-unknown-linux-musl.tar.gz`;
    // xwin publishes no macOS release asset (releases: linux musl x86_64/aarch64 and windows x86_64 only).
    return undefined;
  },
};

export const xwinProvider = toolProvider({
  id: "xwin",
  description: "xwin: MSVC CRT + Windows SDK sysroot for cross-compiling to Windows",
  binary: "xwin",
  versionArgs: ["--version"],
  platforms: ["linux", "darwin", "win32"],
  packages: { pacman: "xwin" },
  github: xwinRelease,
  manual: "cargo install xwin --locked   (or call xwinProvider.ensure() for the checksum-verified release)",
});
