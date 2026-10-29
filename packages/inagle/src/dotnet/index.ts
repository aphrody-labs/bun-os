/**
 * @file index.ts
 * @description Type-safe bridge exposing IECODE .NET & Node-API / NativeAOT to Bun.
 * @module @aphrody/inagle/dotnet
 */

import { dotnetBridge } from "./bridge.js";
import { type DetectedFormat, type DotnetBridgeStatus } from "./types.js";

export * from "./types.js";
export * from "./native.js";
export * from "./fallback.js";
export * from "./bridge.js";

/**
 * Checks whether the native .NET NativeAOT runtime is loaded and ready.
 */
export function isDotnetAvailable(): boolean {
  return dotnetBridge.isAvailable();
}

/**
 * Gets the current .NET bridge status and runtime metadata.
 */
export function getDotnetStatus(): DotnetBridgeStatus {
  return dotnetBridge.status;
}

/**
 * Computes Level-5 reflected CRC32 of given bytes or UTF-8 string.
 */
export function computeLevel5Crc32(data: Uint8Array | string): number {
  return dotnetBridge.computeLevel5Crc32(data);
}

/**
 * Detects binary format of a buffer using IECODE FormatDetector magic tables.
 */
export function detectFormat(data: Uint8Array): DetectedFormat {
  return dotnetBridge.detectFormat(data);
}

/**
 * Checks if the buffer starts with the CRI Layla compression signature ("CRILAYLA").
 */
export function isCrilayla(data: Uint8Array): boolean {
  return dotnetBridge.isCrilayla(data);
}

/**
 * Decompresses CRILAYLA compressed data with byte-exact fidelity.
 */
export function decompressCrilayla(data: Uint8Array): Uint8Array {
  return dotnetBridge.decompressCrilayla(data);
}

/**
 * Compresses data using CRILAYLA bitstream format.
 */
export function compressCrilayla(data: Uint8Array): Uint8Array {
  return dotnetBridge.compressCrilayla(data);
}

/**
 * Decrypts a CRIWARE CPK block using SIMD / native bitwise XOR cipher.
 */
export function decryptCpkBlock(data: Uint8Array, offset?: bigint | number, key?: bigint | number): Uint8Array {
  return dotnetBridge.decryptCpkBlock(data, offset, key);
}

/**
 * Checks if the data begins with Level-5 RDBN configuration binary magic.
 */
export function isRdbn(data: Uint8Array): boolean {
  return dotnetBridge.isRdbn(data);
}

export const dotnet = dotnetBridge;
export default dotnetBridge;
