/**
 * Glyphes gaiji « niveau / évolution de technique » — atlas `gaiji_game2.g4tx` du jeu, exposé via
 * le sous-texturage natif (`g4tx_info_json`, niers) : chaque glyphe est une sous-texture nommée
 * `gaiji_wlv<…>` avec son rect exact dans l'atlas (416×436). Intégration « niers → azalee ».
 *
 * Rects = vérité terrain (décodés du g4tx, byte-exact) ; libellés = lecture visuelle confirmée des
 * glyphes décodés. L'atlas décodé est servi par le CDN (`/dx11/font/fr/gaiji_game2.png`, g4tx→png).
 *
 * Pur et client-safe (types + données ; aucun I/O). Le rendu CSS-sprite vit dans
 * `components/wiki/GaijiGlyph.tsx`.
 */

/** Atlas décodé (PNG) servi par le CDN + ses dimensions natives. */
export const GAIJI_ATLAS = {
  url: "https://cdn.example.com/dx11/font/fr/gaiji_game2.png",
  width: 416,
  height: 436,
} as const;

/** Un glyphe gaiji : rect dans l'atlas + libellé humain. */
export interface GaijiGlyph {
  /** Nom de sous-texture du g4tx (ex. `gaiji_wlv102`). */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Libellé visuel confirmé (ex. `+2`, `V3`, `N2`). */
  label: string;
}

/** Les 21 glyphes utiles (niveaux/évolutions/rangs + IA), par clé courte. */
export const GAIJI: Record<string, GaijiGlyph> = {
  plus1: { name: "gaiji_wlv101", x: 176, y: 352, w: 84, h: 84, label: "+1" },
  plus2: { name: "gaiji_wlv102", x: 0, y: 0, w: 84, h: 84, label: "+2" },
  plus3: { name: "gaiji_wlv103", x: 88, y: 0, w: 84, h: 84, label: "+3" },
  plus5: { name: "gaiji_wlv105", x: 88, y: 88, w: 84, h: 84, label: "+5" },
  plus2x: { name: "gaiji_wlv104", x: 0, y: 88, w: 84, h: 84, label: "+2X" },
  plus2y: { name: "gaiji_wlv124", x: 176, y: 88, w: 84, h: 84, label: "+2Y" },
  plus2z: { name: "gaiji_wlv114", x: 176, y: 0, w: 84, h: 84, label: "+2Z" },
  v2: { name: "gaiji_wlv201", x: 0, y: 176, w: 84, h: 84, label: "V2" },
  v3: { name: "gaiji_wlv202", x: 88, y: 176, w: 84, h: 84, label: "V3" },
  v4: { name: "gaiji_wlv203", x: 176, y: 176, w: 84, h: 84, label: "V4" },
  n2: { name: "gaiji_wlv301", x: 88, y: 264, w: 84, h: 84, label: "N2" },
  n3: { name: "gaiji_wlv302", x: 176, y: 264, w: 84, h: 84, label: "N3" },
  n4: { name: "gaiji_wlv303", x: 264, y: 264, w: 84, h: 84, label: "N4" },
  nx: { name: "gaiji_wlv304", x: 0, y: 352, w: 84, h: 84, label: "Nx" },
  g: { name: "gaiji_wlv305", x: 88, y: 352, w: 84, h: 84, label: "G" },
  infinity: { name: "gaiji_wlv205", x: 264, y: 88, w: 84, h: 84, label: "∞" },
  rankA: { name: "gaiji_wlv204", x: 264, y: 0, w: 84, h: 84, label: "A" },
  rankS: { name: "gaiji_wlv214", x: 264, y: 176, w: 84, h: 84, label: "S" },
  rankZ: { name: "gaiji_wlv224", x: 0, y: 264, w: 84, h: 84, label: "Z" },
  aiOn: { name: "gaiji_ai_only", x: 264, y: 352, w: 112, h: 40, label: "IA ✓" },
  aiOff: { name: "gaiji_ai_ng", x: 264, y: 396, w: 112, h: 40, label: "IA ✗" },
};

export type GaijiKey = keyof typeof GAIJI;

/**
 * Type d'évolution d'une technique (`growth_type` IEVR, 0..7) → glyphes représentatifs.
 *
 * Correspondance ANCRÉE sur la colonne `evolution_type` de `inagle_skills` (libellés du jeu) :
 *   1 = « Normale (+1/+2) » → série `+`   2 = « V (V2/V3) » → série `V`
 *   3 = « G (G2/G3) »      → glyphe `G`   7 = « Infinie (N) » → série `N` (+∞)
 * Les types 0 (« Lente »), 4/5/6 (« Type 4/5/6 ») n'ont pas de libellé-glyphe certain dans la
 * donnée → on n'affiche PAS de glyphe pour eux (texte seul), pour ne rien halluciner.
 */
export const GROWTH_TYPE_GLYPHS: Record<number, GaijiKey[]> = {
  1: ["plus1", "plus2", "plus3"],
  2: ["v2", "v3", "v4"],
  3: ["g"],
  7: ["n2", "n3", "n4", "nx"],
};

/** Libellé humain (FR) du type d'évolution, repli si `evolution_type` texte absent. */
export const GROWTH_TYPE_LABEL: Record<number, string> = {
  0: "Lente",
  1: "Normale",
  2: "Évolution V",
  3: "Évolution G",
  4: "Type 4",
  5: "Type 5",
  6: "Type 6",
  7: "Infinie (N)",
};
