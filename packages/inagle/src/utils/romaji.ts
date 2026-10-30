/**
 * @license
 * Copyright 2026 Aphrody Code
 * SPDX-License-Identifier: Apache-2.0
 */

// The ambient module declarations must not become runtime imports.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/kuroshiro.d.ts" />
import Kuroshiro from "kuroshiro";
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let instance: Kuroshiro | null = null;
let initPromise: Promise<Kuroshiro> | null = null;

/**
 * Initializes the Kuroshiro singleton with Kuromoji analyzer.
 */
export async function initRomaji(): Promise<Kuroshiro> {
  if (instance) return instance;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    const kuro = new Kuroshiro();
    const resolvedUrl = import.meta.resolve("kuromoji");
    const resolvedPath = fileURLToPath(resolvedUrl);

    let kuromojiDir = dirname(resolvedPath);
    if (kuromojiDir.endsWith("src") || kuromojiDir.endsWith("lib")) {
      kuromojiDir = dirname(kuromojiDir);
    }

    const dictPath = join(kuromojiDir, "dict");

    await kuro.init(
      new KuromojiAnalyzer({
        dictPath,
      }),
    );

    instance = kuro;
    return kuro;
  })();

  return initPromise;
}

/**
 * Converts Japanese text (Kanji, Hiragana, Katakana) to Romaji.
 */
export async function toRomaji(
  text: string,
  options?: {
    mode?: "normal" | "spaced" | "okurigana" | "furigana";
    system?: "nippon" | "passport" | "hepburn";
  },
): Promise<string> {
  const kuro = await initRomaji();
  return kuro.convert(text, {
    to: "romaji",
    mode: options?.mode || "normal",
    romajiSystem: options?.system || "hepburn",
  });
}

/**
 * Converts Japanese text to Romaji in title case with spaces (ideal for character names).
 * Example: "円堂守" -> "Endō Mamoru"
 */
export async function toRomajiTitleCase(text: string): Promise<string> {
  const rawRomaji = await toRomaji(text, { mode: "spaced" });

  // Split by space or dot and capitalize each part
  return rawRomaji
    .split(/[・\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(part.length > 1 ? 1 : 0).toLowerCase())
    .join(" ");
}

/**
 * Converts Japanese text to Hiragana or Katakana.
 */
export async function toKana(text: string, target: "hiragana" | "katakana"): Promise<string> {
  const kuro = await initRomaji();
  return kuro.convert(text, {
    to: target,
    mode: "normal",
  });
}
