// SPDX-License-Identifier: MIT
/**
 * `bun:d3d12`: DXGI adapters with their Direct3D 12 feature tiers and the WinRT system profile, from both halves of
 * the stack: C# Native AOT (CsWin32 / CsWinRT, bunos_windows.dll) and C++ (DirectX-Headers d3dx12 / WIL / C++/WinRT,
 * bunos_win_cpp.dll).
 */
import { call, cppCall } from "./native.ts";

export interface D3D12Features {
  supported: boolean;
  hresult?: string;
  maxFeatureLevel?: string;
  shaderModel?: string;
  resourceBindingTier?: string | number;
  tiledResourcesTier?: string | number;
  raytracingTier?: string | number;
  meshShaderTier?: string | number;
  samplerFeedbackTier?: string | number;
  waveOps?: boolean;
  waveLaneCountMin?: number;
  waveLaneCountMax?: number;
  uma?: boolean;
  [feature: string]: unknown;
}

export interface Adapter {
  index: number;
  name: string;
  vendorId: string;
  deviceId: string;
  dedicatedVideoMemory: number;
  sharedSystemMemory: number;
  software: boolean;
  d3d12?: D3D12Features;
  [field: string]: unknown;
}

export interface AdapterOptions {
  /** DXGI GPU preference order (default high-performance). */
  preference?: "high-performance" | "minimum-power" | "unspecified";
  /** Create a D3D12 device per adapter to read its feature tiers (default true). */
  device?: boolean;
  /** "csharp" (Native AOT, default) or "cpp". */
  via?: "csharp" | "cpp";
}

export function adapters(options: AdapterOptions = {}): Adapter[] {
  const { via = "csharp", ...args } = options;
  return via === "cpp" ? cppCall<Adapter[]>("graphics.adapters", args) : call<Adapter[]>("graphics.adapters", args);
}

/** Windows.System.Profile, EAS device information, power state and Win32 facts (C# / CsWinRT). */
export function systemInfo(): Record<string, Record<string, unknown>> {
  return call("system.info");
}

/** The same WinRT profile through C++/WinRT. */
export function systemProfile(): Record<string, unknown> {
  return cppCall("system.profile");
}

export default { adapters, systemInfo, systemProfile };
