// SPDX-License-Identifier: Apache-2.0
export type WindowsErrorCode =
  | "ERR_WINDOWS_UNSUPPORTED"
  | "ERR_WINDOWS_WIN32"
  | "ERR_WINDOWS_PROVIDER_MISSING"
  | "ERR_WINDOWS_HRESULT";

export class WindowsError extends Error {
  readonly code: WindowsErrorCode;
  /** Win32 error code or HRESULT when known. */
  readonly status?: number;
  constructor(code: WindowsErrorCode, message: string, status?: number) {
    super(message);
    this.name = "WindowsError";
    this.code = code;
    this.status = status;
  }
}

export function assertWindows(): void {
  if (process.platform !== "win32") throw new WindowsError("ERR_WINDOWS_UNSUPPORTED", "@aphrody/windows needs Windows");
}
