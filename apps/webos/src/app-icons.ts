// SPDX-License-Identifier: Apache-2.0
// The one place that maps a desktop app to its real upstream icon. Assets live in public/apps/<id>/ and are served
// as-is (no generated art). Each entry records the upstream project and license; license texts of the upstream
// projects stay in their own repositories (vendor/ or the URL below).

export interface AppIconAsset {
  /** Served path of the real icon asset. */
  src: string;
  /** Upstream project the asset comes from. */
  origin: string;
  license: string;
}

const COSMIC_ICON = "pop-os/cosmic-icons";
export const APP_ICONS: Record<string, AppIconAsset> = {
  rio: { src: "/apps/rio/icon.svg", origin: "https://github.com/raphamorim/rio misc/logo-2024.svg", license: "MIT" },
  spacedrive: {
    src: "/apps/spacedrive/icon.png",
    origin: "apps/spacedrive/apps/tauri/src-tauri/icons (Spacedrive)",
    license: "AGPL-3.0",
  },
  "cosmic-files": { src: "/apps/cosmic-files/icon.svg", origin: "https://github.com/pop-os/cosmic-files res/icons", license: "GPL-3.0-only" },
  "cosmic-term": { src: "/apps/cosmic-term/icon.svg", origin: "https://github.com/pop-os/cosmic-term res/icons", license: "GPL-3.0-only" },
  "cosmic-edit": { src: "/apps/cosmic-edit/icon.svg", origin: "https://github.com/pop-os/cosmic-edit res/icons", license: "GPL-3.0-only" },
  "cosmic-store": { src: "/apps/cosmic-store/icon.svg", origin: "https://github.com/pop-os/cosmic-store res/icons", license: "GPL-3.0-only" },
  "cosmic-player": { src: "/apps/cosmic-player/icon.svg", origin: "https://github.com/pop-os/cosmic-player res/icons", license: "GPL-3.0-only" },
  "cosmic-settings": { src: "/apps/cosmic-settings/icon.svg", origin: "https://github.com/pop-os/cosmic-settings resources/icons", license: "GPL-3.0-only" },
  "cosmic-calculator": { src: "/apps/cosmic-calculator/icon.svg", origin: `https://github.com/${COSMIC_ICON} freedesktop/scalable/apps/accessories-calculator.svg`, license: "CC-BY-SA-4.0" },
  linux: { src: "/apps/alpine-linux/icon.svg", origin: "https://alpinelinux.org/alpinelinux-logo.svg", license: "CC-BY-SA-4.0" },
  "aphrody-workspace": { src: "/apps/aphrody/icon.svg", origin: "Aphrody (this repository, apps/webos/public/favicon.svg)", license: "Apache-2.0" },
};

/** Icon string for the shell: the real asset when the app has one, else the given glyph name. */
export function iconFor(id: string, glyph: string): string {
  const a = APP_ICONS[id];
  return a ? `img:${a.src}` : glyph;
}
