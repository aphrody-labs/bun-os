// SPDX-License-Identifier: Apache-2.0
// Unified Aphrody OS Application Shell.
// Public Aphrody workspace: chat, files, models and settings.

// oxlint-disable-next-line import/no-unassigned-import
import "m3:symbols.css";
import { type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PlatformProvider, type Platform } from "./contexts/PlatformContext";
import { Shell } from "./Shell";
import { explorerRoutes } from "./router";
import { DesktopPet, DesktopWidget, SplashScreen } from "./desktop-surfaces";
import { PetGuide } from "./pet-guide-view";
import { QuickBar } from "./quickbar";
import { appReady, isTauri, pickDirectory, pickFile, tauriInvoke } from "./tauri-bridge";

/**
 * Native platform adapter providing OS capabilities (dialogs, window control, links).
 */
const nativePlatform: Platform = {
  platform: isTauri() ? "tauri" : "web",
  openLink(url: string) {
    if (isTauri()) {
      void tauriInvoke("plugin:opener|open_url", { url }).catch(() =>
        window.open(url, "_blank", "noopener,noreferrer"),
      );
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
  confirm(message: string, callback: (result: boolean) => void) {
    callback(window.confirm(message));
  },
  async openDirectoryPickerDialog(opts?: { title?: string; multiple?: boolean }) {
    const res = await pickDirectory(opts?.title ?? "Sélectionner un dossier");
    return res;
  },
  async openFilePickerDialog(opts?: { title?: string; multiple?: boolean }) {
    const res = await pickFile(opts?.title ?? "Sélectionner un fichier");
    return res;
  },
  getCurrentWindowLabel() {
    return "main";
  },
};

function App() {
  useEffect(() => {
    void appReady();
  }, []);

  return (
    <PlatformProvider platform={nativePlatform}>
      <Shell routes={explorerRoutes} />
      <PetGuide />
    </PlatformProvider>
  );
}

const view = new URLSearchParams(window.location.search).get("view");
const views: Record<string, () => ReactNode> = {
  quickbar: () => <QuickBar />,
  splash: () => <SplashScreen />,
  pet: () => <DesktopPet />,
  widget: () => <DesktopWidget />,
};

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render((view && views[view]?.()) ?? <App />);
}
