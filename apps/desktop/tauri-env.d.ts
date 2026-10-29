// `window.__TAURI__` exists only when tauri.conf.json sets app.withGlobalTauri.
interface Window {
  __TAURI__?: typeof import("@tauri-apps/api");
}
