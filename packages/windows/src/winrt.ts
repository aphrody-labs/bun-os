// SPDX-License-Identifier: Apache-2.0
// Windows Runtime through the windows-rs Node-API addon (native/napi). Add calls to native/napi/src/lib.rs
// as needed; this facade stays typed and synchronous.
import { loadAddon, isAddonBuilt, type NapiAddon } from "./provider";

export type UriParts = ReturnType<NapiAddon["winrtUriParse"]>;

export interface FolderInfo {
  name: string;
  displayName: string;
  path: string;
  created: Date;
}

/** True when the WinRT provider is built and loadable. */
export const isAvailable = (): boolean => {
  if (!isAddonBuilt() && !process.env.APHRODY_WINDOWS_NAPI) return false;
  try {
    loadAddon();
    return true;
  } catch {
    return false;
  }
};

/** Windows.Foundation.Uri. */
export const parseUri = (url: string): UriParts => loadAddon().winrtUriParse(url);

/** Windows.Storage.StorageFolder.GetFolderFromPathAsync. */
export function folderInfo(path: string): FolderInfo {
  const info = loadAddon().winrtFolderInfo(path);
  return { name: info.name, displayName: info.displayName, path: info.path, created: new Date(info.createdMs) };
}

/** Windows.System.Profile.AnalyticsInfo device family, such as "Windows.Desktop". */
export const deviceFamily = (): string => loadAddon().winrtDeviceFamily();
