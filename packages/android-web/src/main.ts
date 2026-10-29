import { isTauri } from "@tauri-apps/api/core";
import { getName, getVersion } from "@tauri-apps/api/app";

const status = document.querySelector<HTMLParagraphElement>("#status")!;
if (isTauri()) {
  Promise.all([getName(), getVersion()])
    .then(([name, version]) => {
      status.textContent = `${name} ${version} — WebView Tauri Android`;
    })
    .catch(error => {
      status.textContent = String(error);
    });
} else {
  status.textContent = "Interface Bun chargée.";
}
