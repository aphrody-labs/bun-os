// SPDX-License-Identifier: Apache-2.0
// @aphrody/windows: the single Windows layer of Bun OS on unmodified upstream Bun.
//
//   win32, registry, services, shell   bun:ffi (no build)
//   winrt                              Node-API addon on windows-rs (native/napi)
//   winui                              .NET host process on the Windows App SDK (native/winui-host)
//   clean                              WinClean tool catalog: import "@aphrody/winclean" (re-exports the host below)
//
// @aphrody/winreg is now a re-export of ./registry; @aphrody/winclean keeps its public API.
export * as win32 from "./win32";
export * as registry from "./registry";
export * as services from "./services";
export * as shell from "./shell";
export * as winrt from "./winrt";
export * as winui from "./winui";
export * as provider from "./provider";
export { WindowsError, type WindowsErrorCode } from "./errors";
