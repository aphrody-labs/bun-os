// SPDX-License-Identifier: MIT
// The upstream `unicode-notation-v1` tokenizer: NFKC, case folding, then Python's
// `\d+(?:[x×]\d+)+|[\w]+(?:')?|[+−=]` with Unicode `\w` (letters, numbers, underscore) and `\d` (Nd).

/** Python str.casefold() for the characters where it differs from toLowerCase(). */
const FOLD: Record<string, string> = { ß: "ss", ẞ: "ss", ς: "σ", ſ: "s", ﬅ: "st", ﬆ: "st", İ: "i̇" };

export function casefold(text: string): string {
  return text.toLowerCase().replace(/[ßẞςſﬅﬆİ]/g, c => FOLD[c] ?? c);
}

export function normalize(text: string): string {
  return casefold(text.normalize("NFKC")).replaceAll("’", "'");
}

const TOKEN = /\p{Nd}+(?:[x×]\p{Nd}+)+|[\p{L}\p{N}_]+'?|[+−=]/gu;

export function tokens(text: string): string[] {
  return normalize(text).match(TOKEN) ?? [];
}

export const WORD = "[\\p{L}\\p{N}_]";

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
