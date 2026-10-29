/**
 * Pins of the upstream .NET SDK and PowerShell archives (factory/dotnet-linux/pins.json, written by
 * factory/dotnet-linux/refresh.ts from builds.dotnet.microsoft.com release metadata and PowerShell/PowerShell GitHub
 * releases). Nothing here talks to the network; install.ts verifies every archive against these hashes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type DotnetChannelKey = "10.0" | "11.0";
export type PwshKind = "stable" | "preview";
export type WhatKey = "sdk10" | "sdk11" | "pwsh" | "pwsh-preview";
export const WHAT: readonly WhatKey[] = ["sdk10", "sdk11", "pwsh", "pwsh-preview"];

export interface PinnedAsset {
  url: string;
  sha512?: string;
  sha256?: string;
  size?: number;
}
export interface DotnetPin {
  channel: string;
  supportPhase: string;
  sdk: string;
  runtime?: string;
  aspnetcore?: string;
  release: string;
  assets: Record<string, PinnedAsset>;
}
export interface PwshPin {
  tag: string;
  version: string;
  assets: Record<string, PinnedAsset>;
}
export interface Pins {
  observedAt: string;
  dotnet: Record<DotnetChannelKey, DotnetPin>;
  powershell: Record<PwshKind, PwshPin>;
  distro: unknown;
}

/** Nearest `factory/dotnet-linux/pins.json` at or above `root`. */
export function pinsFile(root: string): string {
  let dir = resolve(root);
  for (;;) {
    const candidate = join(dir, "factory", "dotnet-linux", "pins.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`factory/dotnet-linux/pins.json not found above ${root}`);
    dir = parent;
  }
}

export function loadPins(root: string): Pins {
  return JSON.parse(readFileSync(pinsFile(root), "utf8")) as Pins;
}

export interface Resolved {
  what: WhatKey;
  version: string;
  rid: string;
  name: string;
  url: string;
  algorithm: "sha256" | "sha512";
  hash: string;
}

/** The pinned archive for `what` on `rid` (linux-x64, linux-arm64, linux-musl-x64, linux-musl-arm64 for .NET; no musl-arm64 for pwsh). */
export function resolvePinned(pins: Pins, what: WhatKey, rid: string): Resolved {
  if (what === "sdk10" || what === "sdk11") {
    const pin = pins.dotnet[what === "sdk10" ? "10.0" : "11.0"];
    const asset = pin.assets[rid];
    if (!asset?.sha512) throw new Error(`no pinned .NET SDK ${pin.sdk} archive for ${rid}`);
    return {
      what,
      version: pin.sdk,
      rid,
      name: `dotnet-sdk-${rid}.tar.gz`,
      url: asset.url,
      algorithm: "sha512",
      hash: asset.sha512,
    };
  }
  const pin = pins.powershell[what === "pwsh" ? "stable" : "preview"];
  const asset = pin.assets[rid];
  if (!asset?.sha256)
    throw new Error(
      `no pinned PowerShell ${pin.version} archive for ${rid} (upstream ships ${Object.keys(pin.assets).join(", ")})`,
    );
  return {
    what,
    version: pin.version,
    rid,
    name: `powershell-${pin.version}-${rid}.tar.gz`,
    url: asset.url,
    algorithm: "sha256",
    hash: asset.sha256,
  };
}
