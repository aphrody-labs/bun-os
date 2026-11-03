// Loads a managed [UnmanagedCallersOnly] method through the shared Bun OS .NET host (`bun:dotnet`, hostfxr over
// bun:ffi in @aphrody/bun-os-plugins), so the package runs on upstream Bun without a dedicated runtime module.
// https://github.com/dotnet/runtime/blob/main/docs/design/features/native-hosting.md
import type { FFIFunction } from "bun:ffi";
import { initialize, runtimeConfig, unmanaged as hostUnmanaged } from "@aphrody/bun-os-plugins/dotnet";
import { locate } from "@aphrody/bun-os-plugins/dotnet/hostfxr";

export interface ManagedMethod {
  /** Full path of the managed assembly; `<name>.runtimeconfig.json` must sit beside it. */
  assembly: string;
  /** Assembly-qualified type name, e.g. `Aphrody.Ds.Exports, Aphrody.Ds`. */
  type: string;
  /** Method name; it must carry [UnmanagedCallersOnly]. */
  method: string;
}

/** The newest installed hostfxr library, from DOTNET_ROOT, the dotnet on PATH, or the default install location. */
export function findHostfxr(): string {
  return locate().hostfxr;
}

/**
 * Resolves an [UnmanagedCallersOnly] static method of a managed assembly to a callable native function. The first
 * call starts the .NET runtime of the process from `<assembly>.runtimeconfig.json`.
 */
export function unmanaged<T extends (...args: never[]) => unknown>(
  method: ManagedMethod,
  signature: Pick<FFIFunction, "args" | "returns">,
): T {
  if (runtimeConfig() === null) initialize(method.assembly.replace(/\.dll$/i, ".runtimeconfig.json"));
  return hostUnmanaged(method, signature) as unknown as T;
}
