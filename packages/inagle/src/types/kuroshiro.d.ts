/**
 * @license
 * Copyright 2026 Aphrody Code
 * SPDX-License-Identifier: Apache-2.0
 */

declare module "kuroshiro" {
  export default class Kuroshiro {
    constructor();
    init(analyzer: unknown): Promise<void>;
    convert(
      text: string,
      options: {
        to: "hiragana" | "katakana" | "romaji";
        mode?: "normal" | "spaced" | "okurigana" | "furigana";
        romajiSystem?: "nippon" | "passport" | "hepburn";
      },
    ): Promise<string>;
  }
}

declare module "kuroshiro-analyzer-kuromoji" {
  export default class KuromojiAnalyzer {
    constructor(options: { dictPath: string });
  }
}
