// SPDX-License-Identifier: Apache-2.0
// Known folders through shell32 SHGetKnownFolderPath.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { assertWindows, WindowsError } from "./errors";
import { guid, readWide } from "./ffi";

/** FOLDERID_* values (https://learn.microsoft.com/windows/win32/shell/knownfolderid). */
export const FOLDER_IDS = {
  Desktop: "B4BFCC3A-DB2C-424C-B029-7FE99A87C641",
  Documents: "FDD39AD0-238F-46AF-ADB4-6C85480369C7",
  Downloads: "374DE290-123F-4565-9164-39C4925E467B",
  LocalAppData: "F1B32785-6FBA-4FCF-9D55-7B8E7F157091",
  RoamingAppData: "3EB685DB-65F9-4CF6-A03A-E3EF65729F3D",
  ProgramData: "62AB5D82-FDC1-4DC3-A9DD-070D1D495D97",
  ProgramFiles: "905E63B6-C1BF-494E-B29C-65B732D3D21A",
  Windows: "F38BF404-1D43-42F2-9305-67DE0B28FC23",
  System: "1AC14E77-02E7-4E5D-B744-2EB1AE5198B7",
  Profile: "5E6C858F-0E22-4760-9AFE-EA3317B67173",
  Startup: "B97D20BB-F46A-4C97-BA10-5E3608430854",
} as const;

export type KnownFolder = keyof typeof FOLDER_IDS;

const load = () =>
  dlopen("shell32.dll", {
    SHGetKnownFolderPath: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
const loadOle = () => dlopen("ole32.dll", { CoTaskMemFree: { args: [FFIType.u64], returns: FFIType.void } }).symbols;

let api: ReturnType<typeof load> | undefined;
let ole: ReturnType<typeof loadOle> | undefined;

/** Path of a known folder by name or FOLDERID GUID. */
export function knownFolder(folder: KnownFolder | (string & {})): string {
  assertWindows();
  api ??= load();
  ole ??= loadOle();
  const id = guid(folder in FOLDER_IDS ? FOLDER_IDS[folder as KnownFolder] : folder);
  const out = new BigUint64Array(1);
  const hr = api.SHGetKnownFolderPath(ptr(id), 0, 0n, ptr(out));
  try {
    if (hr < 0) {
      throw new WindowsError("ERR_WINDOWS_HRESULT", `SHGetKnownFolderPath(${folder}) = 0x${(hr >>> 0).toString(16)}`, hr);
    }
    return readWide(out[0]!);
  } finally {
    if (out[0]) ole.CoTaskMemFree(out[0]);
  }
}
