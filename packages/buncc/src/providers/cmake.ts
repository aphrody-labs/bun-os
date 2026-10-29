/** CMake: detect and install (winget/pacman/apt or the checksum-verified Kitware release). */
import { toolProvider } from "./_tool.ts";
import type { GithubToolSpec } from "./_github.ts";

const CMAKE_OS = { win32: "windows", linux: "linux", darwin: "macos" } as const;

export const cmakeRelease: GithubToolSpec = {
  id: "cmake",
  repo: "Kitware/CMake",
  binary: "cmake",
  asset(tag, platform, arch) {
    const v = tag.replace(/^v/, "");
    if (platform === "darwin") return `cmake-${v}-macos-universal.tar.gz`;
    const cpu = arch === "arm64" ? (platform === "win32" ? "arm64" : "aarch64") : arch === "x64" ? "x86_64" : undefined;
    if (!cpu) return undefined;
    return `cmake-${v}-${CMAKE_OS[platform]}-${cpu}.${platform === "win32" ? "zip" : "tar.gz"}`;
  },
};

export const cmakeProvider = toolProvider({
  id: "cmake",
  description: "CMake build-system generator",
  binary: "cmake",
  versionArgs: ["--version"],
  packages: { winget: "Kitware.CMake", pacman: "cmake", apt: "cmake", dnf: "cmake", apk: "cmake", brew: "cmake" },
  github: cmakeRelease,
});
