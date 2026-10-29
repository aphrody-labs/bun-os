// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { getLocale, setLocale, t, SUPPORTED_LOCALES, getCatalog } from "../src/i18n.ts";

describe("M3 i18n localization contract", () => {
  test("supported locales are en and fr", () => {
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("fr");
  });

  test("translates common and nav across en and fr with exact symmetry", () => {
    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("common.save")).toBe("Save");
    expect(t("nav.files")).toBe("Files & Drive");
    expect(t("chat.title")).toBe("Aphrody Agent Console");
    expect(t("subsystems.web")).toBe("Web & Obscura Engine");
    expect(t("koharu.title")).toBe("Koharu Document & Vision Engine");
    expect(t("drive.title")).toBe("Aphrody Drive Engine");
    expect(t("shell.title")).toBe("Aphrody Native Shell & PTY");
    expect(t("ffi.title")).toBe("Aphrody Native FFI Bridge");

    setLocale("fr");
    expect(getLocale()).toBe("fr");
    expect(t("common.save")).toBe("Enregistrer");
    expect(t("nav.files")).toBe("Fichiers & Drive");
    expect(t("chat.title")).toBe("Console d'Agent Aphrody");
    expect(t("subsystems.web")).toBe("Moteur Web & Obscura");
    expect(t("koharu.title")).toBe("Moteur Document & Vision Koharu");
    expect(t("drive.title")).toBe("Moteur Aphrody Drive");
    expect(t("shell.title")).toBe("Shell natif Aphrody & PTY");
    expect(t("ffi.title")).toBe("Pont FFI natif d'Aphrody");

    // Reset back to English
    setLocale("en");
  });

  test("catalogs have identical keys and non-empty values", () => {
    const en = getCatalog("en");
    const fr = getCatalog("fr");

    expect(Object.keys(en)).toEqual(Object.keys(fr));

    for (const ns of Object.keys(en) as (keyof typeof en)[]) {
      const enKeys = Object.keys(en[ns]);
      const frKeys = Object.keys(fr[ns]);
      expect(enKeys.toSorted()).toEqual(frKeys.toSorted());

      for (const key of enKeys) {
        expect((en[ns] as Record<string, string>)[key].length).toBeGreaterThan(0);
        expect((fr[ns] as Record<string, string>)[key].length).toBeGreaterThan(0);
      }
    }
  });

  test("supports explicit locale override in t() call", () => {
    expect(t("common.delete", undefined, "en")).toBe("Delete");
    expect(t("common.delete", undefined, "fr")).toBe("Supprimer");
  });
});
