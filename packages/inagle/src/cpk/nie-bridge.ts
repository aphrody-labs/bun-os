/**
 * @file nie-bridge.ts
 * @description Bridges Azalee CPK extraction to the verified byte-exact CPK / @UTF table schema
 * and CRILAYLA decompression algorithms matching aphrody-nie-formats::cpk.
 * Deduplicated and unified through @aphrody/inagle/nie-bridge.
 */

import {
  CPK_LAYOUT,
  CPK_MAGIC,
  CRILAYLA_MIN_FILE_SIZE,
  CRILAYLA_RAW_HEADER_SIZE,
  UTF_MAGIC,
  VIOLA_FIXED_KEY,
  computeLevel5Crc32,
  computeNieCrc32,
  decompressCrilayla,
  decryptCpkBlock,
  deriveCpkKeyFromFilename,
  isCrilayla,
  probeFormat,
} from "../nie-bridge/index.ts";

export {
  CPK_MAGIC,
  CRILAYLA_MIN_FILE_SIZE,
  CRILAYLA_RAW_HEADER_SIZE,
  UTF_MAGIC,
  VIOLA_FIXED_KEY,
  computeLevel5Crc32,
  computeNieCrc32,
  decompressCrilayla,
  decryptCpkBlock,
  deriveCpkKeyFromFilename,
  isCrilayla,
};
export const SECTOR_SIZE = CPK_LAYOUT.HEADER_SIZE;

export interface CpkHeaderVerification {
  isValid: boolean;
  magic: number;
  sectorSize: number;
  utfOffset: number;
  tocOffset?: number;
  etocOffset?: number;
  itocOffset?: number;
  filesCount?: number;
}

/**
 * Validates a CPK archive header buffer against authoritative CRI / Level-5 binary contracts from NIE.
 */
export function verifyCpkBuffer(buffer: ArrayBuffer | Uint8Array): CpkHeaderVerification {
  const probe = probeFormat(buffer);
  if (probe.kind !== "cpk" || !probe.isValid) {
    return {
      isValid: false,
      magic: probe.magic,
      sectorSize: SECTOR_SIZE,
      utfOffset: 0,
    };
  }

  const view =
    buffer instanceof Uint8Array
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer);

  let utfOffset = 16;
  let hasUtf = false;
  if (view.byteLength >= utfOffset + 4) {
    const utfMagic = view.getUint32(utfOffset, false);
    if (utfMagic === UTF_MAGIC) {
      hasUtf = true;
    }
  }

  return {
    isValid: true,
    magic: probe.magic,
    sectorSize: SECTOR_SIZE,
    utfOffset: hasUtf ? utfOffset : 0,
  };
}
