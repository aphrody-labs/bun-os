// SPDX-License-Identifier: Apache-2.0
import type { SupportedLanguage } from "../../i18n";
import { nativeGoogleMessages } from "../product/product-search-messages";
export const studioSections = [
  { id: "a2a", label: "Outils des agents", icon: "hub" },
  { id: "google", label: "Recherche Aphrody", icon: "search" },
  { id: "runtime", label: "Moteur", icon: "memory" },
] as const;
export type StudioSection = (typeof studioSections)[number]["id"];
export function studioLabel(section: StudioSection, language: SupportedLanguage): string {
  return section === "google"
    ? nativeGoogleMessages[language].title
    : studioSections.find(entry => entry.id === section)!.label;
}
export function studioSection(value: string | null): StudioSection {
  return studioSections.find(entry => entry.id === value)?.id ?? "a2a";
}
export function studioPath(section: StudioSection): string {
  return "/studio?section=" + section;
}
