/**
 * Enhanced Zukan Types for the Inagle API
 * Based on zukan.inazuma.jp (Inazugle)
 */

export type ZukanElementType = "Wind" | "Forest" | "Fire" | "Mountain" | "Void" | "Unknown";
export type ZukanPositionType = "GK" | "DF" | "MF" | "FW";
export type ZukanGenderType = "Male" | "Female" | "Unknown" | "Neutral";
export type ZukanSchoolYearType = "Grade 7" | "Grade 8" | "Grade 9" | "Unknown";
export type ZukanCharacterRole = "Player" | "Coordinator" | "Manager" | "Coach";

/** 9 game keys matching the zukan appeared-works columns (order matters) */
export const GAME_KEYS = ["ie1", "ie2", "ie3", "go1", "go2", "go3", "ars", "ori", "vic"] as const;
export type GameKey = (typeof GAME_KEYS)[number];

/** Map game key → Azalee series name */
export const GAME_TO_SERIES: Record<GameKey, string> = {
  ie1: "Inazuma Eleven",
  ie2: "Inazuma Eleven 2",
  ie3: "Inazuma Eleven 3",
  go1: "Inazuma Eleven GO",
  go2: "Chrono Stone",
  go3: "Galaxy",
  ars: "Ares",
  ori: "Orion",
  vic: "Victory Road",
};

export interface ZukanCharacter {
  id: string; // Internal Zukan ID (e.g., from data-chara-id)
  modelId?: string; // Canonical 3D model ID (e.g., c01000010)
  name: string;
  nickname: string | null;
  image: string | null;
  detailUrl: string | null;
  zukanHash?: string;
  zukanOrder?: number;

  // Attributes
  rarity: string | null; // Grade/Rank
  position: ZukanPositionType | null;
  element: ZukanElementType | null;
  gender: ZukanGenderType | null;
  schoolYear: string | null;
  ageGroup?: string | null;
  team: string | null;
  role: ZukanCharacterRole | null;
  description?: string;
  howToObtain?: string;

  /** Games in which this character appears (○ on the zukan grid) */
  gameAppearances?: GameKey[];

  // Stats (Parsed from chara_param)
  stats?: {
    kick: number;
    control: number;
    technique: number;
    pressure: number;
    physical: number;
    agility: number;
    intelligence: number;
  };

  // Move Set
  moves?: {
    name: string;
    type: string;
    description?: string;
    power?: number;
    cost?: number;
  }[];
}

/**
 * Une vidéo de technique telle que publiée par zukan.inazuma.jp.
 *
 * 236 techniques sur 895 exposent DEUX vidéos dans leur `.btnBox`
 * (Shot/Success/Failure/Defence/Offence/Shot Block) : le libellé du bouton est
 * la seule chose qui les distingue, on le conserve donc tel quel.
 */
export interface ZukanSkillVideo {
  /** Libellé du bouton (variante) : "Shot", "Success", "Failure", "Defence", "Offence", "Shot Block". */
  label: string;
  /** Rang d'apparition dans le `.btnBox` (0 = vidéo principale). */
  position: number;
  videoUrl: string | null;
  posterUrl: string | null;
}

export interface ZukanSkill {
  id: string;
  name: string;
  type: string; // e.g. "Shoot", "Dribble", "Block", "Catch"
  description?: string;
  element: ZukanElementType | null;
  /** Vidéo principale (= `videos[0]`), conservée pour compatibilité. */
  videoUrl: string | null;
  /** Poster de la vidéo principale (= `videos[0]`), conservé pour compatibilité. */
  posterUrl: string | null;
  thumbnailUrl: string | null;
  /** Toutes les variantes vidéo de la technique (1 ou 2 en pratique). */
  videos: ZukanSkillVideo[];
}

export interface ZukanItem {
  id: string; // generated from hash or name
  name: string;
  category: string; // 'shoes', 'bracelet', 'pendant', 'special', 'uniform', 'emblem'
  description?: string;
  imageUrl: string | null;
}

export interface ZukanFormation {
  id: string; // generated from hash or name
  name: string;
  positions: { left: string; top: string }[];
}

export interface ZukanTeam {
  id: string;
  name: string;
  emblemUrl: string | null;
}
