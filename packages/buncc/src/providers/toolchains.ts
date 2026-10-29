/**
 * Every toolchain provider ported from the fork (msvc, winget, dotnet, vcpkg, cmake, clang, make family, xwin, gn,
 * msix/wix, archpkg, wasm, uv, just). The core registry imports `toolchainProviders` and filters by `platforms`.
 */
import { clangProvider } from "./clang.ts";
import { cmakeProvider } from "./cmake.ts";
import { dotnetProfileProvider, dotnetProvider } from "./dotnet.ts";
import { gnProvider } from "./gn.ts";
import { justProvider } from "./just.ts";
import { makeProvider, mesonProvider, ninjaProvider, pkgconfProvider } from "./make.ts";
import { msixProvider, wixProvider } from "./msix.ts";
import { msvcLayoutProvider } from "./msvc-layout.ts";
import { makepkgProvider } from "./archpkg.ts";
import { uvProvider } from "./uv.ts";
import { vcpkgProvider } from "./vcpkg.ts";
import { wasmBindgenProvider, wasmOptProvider } from "./wasm.ts";
import { wingetProvider } from "./winget.ts";
import { xwinProvider } from "./xwin.ts";
import type { Provider } from "./types.ts";

export const toolchainProviders: Provider[] = [
  msvcLayoutProvider,
  wingetProvider,
  dotnetProvider,
  dotnetProfileProvider("aot-dotnet10"),
  dotnetProfileProvider("aot-dotnet11"),
  vcpkgProvider,
  cmakeProvider,
  clangProvider,
  makeProvider,
  ninjaProvider,
  mesonProvider,
  pkgconfProvider,
  xwinProvider,
  gnProvider,
  msixProvider,
  wixProvider,
  makepkgProvider,
  wasmBindgenProvider,
  wasmOptProvider,
  uvProvider,
  justProvider,
];

export {
  clangProvider,
  cmakeProvider,
  dotnetProfileProvider,
  dotnetProvider,
  gnProvider,
  justProvider,
  makeProvider,
  makepkgProvider,
  mesonProvider,
  msixProvider,
  msvcLayoutProvider,
  ninjaProvider,
  pkgconfProvider,
  uvProvider,
  vcpkgProvider,
  wasmBindgenProvider,
  wasmOptProvider,
  wingetProvider,
  wixProvider,
  xwinProvider,
};

/**
 * Ids that the core registry already defines with a simpler detect/install-only provider (`providers/tools.ts`,
 * `providers/index.ts`). These providers are drop-in replacements: same id, plus verified downloads, argument builders and
 * pinned-channel handling. Register them before the core ones so `getProvider(id)` returns these.
 */
export const REPLACES_CORE_IDS = ["winget", "dotnet", "vcpkg", "cmake", "clang", "make", "ninja", "gn", "wix"] as const;
