// SPDX-License-Identifier: Apache-2.0
/**
 * @fileoverview Sovereign Ecosystem Brand Vector Assets
 * Pixel-perfect SVG vector paths and metadata for Bun OS core pillars:
 * Aphrody, Bun, COSMIC, Google, Android, Waydroid, and Gemini.
 */

export interface EcosystemAsset {
  name: string;
  title: string;
  category: "brand" | "os" | "runtime" | "desktop" | "mobile" | "ai";
  svgPath: string;
  primaryColor: string;
  viewBox: string;
}

export const ECOSYSTEM_ASSETS: Record<string, EcosystemAsset> = {
  aphrody: {
    name: "aphrody",
    title: "Aphrody (Byron Love Brand Emblem)",
    category: "brand",
    svgPath: "brand/icon.svg",
    primaryColor: "#fce881",
    viewBox: "0 0 256 256",
  },
  bun: {
    name: "bun",
    title: "Bun Fast JavaScript/TypeScript & Native Systems Runtime",
    category: "runtime",
    svgPath: "bun.svg",
    primaryColor: "#fbf0df",
    viewBox: "0 0 256 256",
  },
  cosmic: {
    name: "cosmic",
    title: "System76 COSMIC Desktop Shell (libcosmic / iced)",
    category: "desktop",
    svgPath: "cosmic.svg",
    primaryColor: "#48b9c7",
    viewBox: "0 0 24 24",
  },
  google: {
    name: "google",
    title: "Google Core Services & Google Fonts",
    category: "brand",
    svgPath: "google.svg",
    primaryColor: "#4285F4",
    viewBox: "0 0 24 24",
  },
  android: {
    name: "android",
    title: "Android 17 Container Multi-Window Runtime",
    category: "mobile",
    svgPath: "android.svg",
    primaryColor: "#3DDC84",
    viewBox: "0 0 24 24",
  },
  waydroid: {
    name: "waydroid",
    title: "Waydroid Container Streaming Engine",
    category: "os",
    svgPath: "waydroid.svg",
    primaryColor: "#3DDC84",
    viewBox: "0 0 24 24",
  },
  gemini: {
    name: "gemini",
    title: "Google Gemini Multimodal AI & Live Voice",
    category: "ai",
    svgPath: "gemini.svg",
    primaryColor: "#8ab4f8",
    viewBox: "0 0 24 24",
  },
};
