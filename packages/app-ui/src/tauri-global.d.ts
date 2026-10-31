// SPDX-License-Identifier: Apache-2.0
// The Tauri global API injected by a Tauri host (withGlobalTauri); absent in a plain browser.
interface TauriGlobalEvent<T> {
  payload: T;
}

interface Window {
  __TAURI__?: {
    core: {
      invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
    event?: {
      listen<T = unknown>(name: string, handler: (event: TauriGlobalEvent<T>) => void): Promise<() => void>;
    };
  };
}
