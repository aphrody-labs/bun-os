/**
 * Detect and install the two CLI tools of the Rust-to-wasm pipeline. The pipeline itself (cargo build, wasm-bindgen at
 * the version Cargo.lock pins, wasm-opt flags, WASI run) is owned by `packages/wasm` (`@aphrody/wasm`).
 */
import type { GithubToolSpec } from "./_github.ts";
import { toolProvider } from "./_tool.ts";

export const wasmBindgenProvider = toolProvider({
  id: "wasm-bindgen",
  description: "wasm-bindgen CLI (must match the crate's wasm-bindgen version)",
  binary: "wasm-bindgen",
  versionArgs: ["--version"],
  manual: "cargo install wasm-bindgen-cli --version <version from Cargo.lock> --locked",
});

export const binaryenRelease: GithubToolSpec = {
  id: "wasm-opt",
  repo: "WebAssembly/binaryen",
  binary: "wasm-opt",
  version: tag => tag.replace(/^version_/, ""),
  asset(tag, platform, arch) {
    const os = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
    const cpu =
      platform === "darwin"
        ? arch === "arm64"
          ? "arm64"
          : "x86_64"
        : arch === "arm64"
          ? platform === "win32"
            ? "arm64"
            : "aarch64"
          : "x86_64";
    return `binaryen-${tag}-${cpu}-${os}.tar.gz`;
  },
};

export const wasmOptProvider = toolProvider({
  id: "wasm-opt",
  description: "Binaryen wasm-opt",
  binary: "wasm-opt",
  versionArgs: ["--version"],
  packages: { pacman: "binaryen", apt: "binaryen", dnf: "binaryen", apk: "binaryen", brew: "binaryen" },
  github: binaryenRelease,
});
