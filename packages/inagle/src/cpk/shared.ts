/**
 * Types + helpers PURS de l'index CPK, client-safe.
 *
 * Ce module ne touche NI PostgreSQL, NI Node, NI le réseau → importable depuis un
 * composant `"use client"` comme depuis une page serveur (cf. frontière stricte
 * azalee : un `"use client"` ne doit jamais importer une valeur d'une lib qui
 * touche sqlite/supabase-server/Node). Le data-fetch SQLite vit dans
 * `cpk/index.ts` (sous-chemin serveur de la lib).
 *
 * `cpkAssetUrl()` mappe un `(path, ext)` de l'index vers l'URL CDN qui sert le
 * CONTENU décodé du fichier — le CDN `cdn.example.com` décode déjà tout
 * fichier CPK live. Mapping validé par probe HTTP (vérité terrain) :
 *   - g4tx (100 % sous `data/dx11/`) → `/dx11/<path-après-data/dx11/>.png`
 *     (décodage g4tx→png live ; 200 image/png mesuré).
 *   - g4md/g4mg → `/model-full/<code>.glb` (assemblage glTF live ; 200 pour les
 *     codes assemblables, 404 sinon → cf. note sur la branche model).
 *   - autre → `/raw/<path>` (bytes décompressés bruts du CPK).
 */

/** Une ligne de l'index CPK (forme exposée par l'API/lib). */
export interface CpkFile {
  /** Nom de fichier, ex. `c05021090_l.g4tx`. */
  name: string;
  /** Extension sans point, ex. `g4tx` | `bin` | `g4md`. */
  ext: string;
  /** Archive CPK contenant le fichier, ex. `<hash>.cpk`. */
  cpk: string;
  /** Chemin complet, ex. `data/dx11/menu/.../c05021090_l.g4tx`. */
  path: string;
}

/** Un sous-dossier d'un répertoire de l'index, avec son nombre de descendants. */
export interface CpkDir {
  /** Nom du segment, ex. `face` | `menu` | `_uniform`. */
  name: string;
  /** Nombre total de fichiers sous ce sous-dossier (récursif). */
  count: number;
}

/** Résultat d'un listing de répertoire (`listDir`). */
export interface CpkListing {
  /** Le répertoire listé (chemin normalisé, sans slash final). */
  dir: string;
  /** Sous-dossiers directs, triés par nom. */
  dirs: CpkDir[];
  /** Fichiers directs du répertoire, triés par nom. */
  files: CpkFile[];
}

/** Type de contenu CDN dérivé de l'extension. */
export type CpkAssetKind = "image" | "model" | "raw";

export const CDN_BASE =
  (typeof process !== "undefined" && (process.env.NIE_CDN_BASE || process.env.MODEL_SERVE_URL)) || "";

/** Extensions décodées en image (g4tx → png live par le CDN). */
const IMAGE_EXTS = new Set(["g4tx"]);
/** Extensions de modèle 3D (assemblées en glb live par le CDN `/model/`). */
const MODEL_EXTS = new Set(["g4md", "g4mg"]);

/** Catégorise une extension d'index en famille de contenu CDN. */
export function cpkAssetKind(ext: string): CpkAssetKind {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (MODEL_EXTS.has(e)) return "model";
  return "raw";
}

/** Retire le préfixe racine `data/` d'un chemin index. */
function stripDataPrefix(path: string): string {
  return path.startsWith("data/") ? path.slice("data/".length) : path;
}

/** Encode VFS path segments for URL transport while keeping directory separators. */
function encodeVfsPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * URL CDN du CONTENU d'un fichier de l'index.
 *
 * @param path chemin complet de l'index (avec préfixe `data/`).
 * @param ext  extension sans point (si omis, dérivée du `path`).
 * @returns l'URL CDN, ou `null` si aucun mapping fiable (le caller fallback).
 */
export function cpkAssetUrl(path: string, ext?: string): string | null {
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? path;
  const dot = name.lastIndexOf(".");
  const e = (ext ?? (dot > 0 ? name.slice(dot + 1) : "")).toLowerCase();
  const kind = cpkAssetKind(e);

  if (kind === "image") {
    // g4tx vivent 100 % sous `data/dx11/` → `/dx11/<reste>.png` (g4tx→png live).
    const rel = path.startsWith("data/dx11/") ? path.slice("data/dx11/".length) : stripDataPrefix(path);
    const noExt = rel.replace(/\.g4tx$/i, "");
    return `${CDN_BASE}/dx11/${encodeVfsPath(noExt)}.png`;
  }

  if (kind === "model") {
    // `/model-full/<code>.glb` — assemblage glTF live (corps+visage+uniforme) par
    // nie-model-serve. `code` = basename sans extension (ex. `n031708`). ⚠ 404 pour les
    // codes non assemblables (uniforme `n0…`, visage, props) : la fiche fichier ne montre
    // donc PAS ce lien pour les modèles (cf. CpkFilePreview) — le viewer 3D assemble
    // in-browser et propose son propre GLB. Mapping conservé pour `CpkFileMeta.assetUrl`.
    const base = name.replace(/\.(g4md|g4mg)$/i, "");
    return `${CDN_BASE}/model-full/${encodeURIComponent(base)}.glb`;
  }

  // raw : bytes décompressés/déchiffrés bruts du CPK (nie-model-serve /raw, texte/download).
  return `${CDN_BASE}/raw/${encodeVfsPath(path)}`;
}

/**
 * URL du décodage JSON natif d'un `cfg.bin`/`objbin`/`fxbin`/`mevbin` (RDBN ou T2B)
 * par nie-model-serve (`/cfg/<vfs-path>.json`). `path` = chemin d'index (préfixe `data/`).
 */
export function cpkCfgUrl(path: string): string {
  return `${CDN_BASE}/cfg/${encodeVfsPath(path)}.json`;
}

/** URL des bytes bruts décompressés du CPK (`/raw/<vfs-path>`) — texte, download, lecteurs. */
export function cpkRawUrl(path: string): string {
  return `${CDN_BASE}/raw/${encodeVfsPath(path)}`;
}

/**
 * URL du décodage audio CRI (`/audio/<vfs-path>`) → WAV PCM 16-bit décodé live par
 * nie-model-serve (HCA/ADX, conteneurs ACB/AWB). Lisible directement par `<audio>`.
 */
export function cpkAudioUrl(path: string): string {
  return `${CDN_BASE}/audio/${encodeVfsPath(path)}`;
}

/**
 * URL du décodage vidéo CRI (`/video/<vfs-path>`) → MP4 fragmenté (démux USM Sofdec2
 * + remux H.264) décodé live par nie-model-serve. Lisible directement par `<video>`.
 */
export function cpkVideoUrl(path: string): string {
  return `${CDN_BASE}/video/${encodeVfsPath(path)}`;
}

/**
 * Variante WebP redimensionnée pour les vignettes d'images (g4tx → webp `?w=`).
 * Sert la galerie/arbre en léger ; `null` si l'extension n'est pas une image.
 */
export function cpkThumbUrl(path: string, ext?: string, width = 400): string | null {
  const url = cpkAssetUrl(path, ext);
  if (!url || cpkAssetKind(ext ?? path.split(".").pop() ?? "") !== "image") return null;
  // `/dx11/...png` accepte `?w=&format=webp` (cdn-variants resize+webp).
  return `${url}?w=${width}&format=webp`;
}

/** Libellé humain d'un segment top-level (pour l'UI de l'arbre). */
export function topLabel(top: string): string {
  const labels: Record<string, string> = {
    common: "Commun",
    dx11: "DX11 (PC)",
    movie: "Vidéos",
    font: "Polices",
  };
  return labels[top] ?? top;
}

/**
 * Libellé humain d'un segment de chemin connu (sous-dossiers récurrents de
 * l'index). Sert le fil d'Ariane et les en-têtes de répertoire. Repli : le
 * segment brut (les noms techniques restent lisibles : `_face`, `c05021090`…).
 */
export function segLabel(seg: string): string {
  // Labels VÉRIFIÉS contre le contenu réel des dossiers (vérité terrain). Les segments
  // non listés gardent leur nom technique brut — on ne traduit pas ce qu'on ne sait pas
  // (ex. `chr` n'est PAS « Personnages » : il contient aussi visages/uniformes/waza/
  // keshin/objets — c'est la racine des MODÈLES 3D).
  const labels: Record<string, string> = {
    event: "Événements",
    event_cfg: "Config événements",
    text: "Textes",
    chr: "Modèles 3D",
    sound: "Sons",
    sound_asset: "Assets sonores",
    map: "Cartes",
    gamedata: "Données de jeu",
    effect: "Effets",
    menu: "Menus",
    shader: "Shaders",
    movie: "Vidéos",
    font: "Polices",
    script: "Scripts",
    craft: "Artisanat",
    // Sous-dossiers de `chr/` (modèles 3D) :
    _face: "Visages",
    _uniform: "Uniformes",
    _waza: "Techniques (waza)",
    _keshin: "Keshin",
    _item: "Objets",
  };
  return labels[seg] ?? seg;
}

/** Normalise un chemin de répertoire : retire les slashs de tête/queue. */
export function normalizeDir(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

// --- Classification de PREVIEW (par extension) -----------------------------

/**
 * Famille de PREVIEW d'un fichier, plus fine que `CpkAssetKind` : pilote le
 * rendu de la fiche fichier (`<img>`, viewer 3D, player audio/vidéo, texte,
 * config binaire, ou lien brut). Purement dérivée de l'extension.
 */
export type CpkPreviewKind = "image" | "model" | "text" | "config" | "sound" | "movie" | "package" | "raw";

const TEXT_EXTS = new Set(["txt", "json", "xml", "csv", "lua", "cfg", "ini", "yml", "yaml"]);
// `ext` = dernier segment après le point (cf. materialize.ts), donc `foo.cfg.bin` → ext `bin`.
const CONFIG_EXTS = new Set(["bin", "objbin", "fxbin", "mevbin"]);
const SOUND_EXTS = new Set(["acb", "awb", "hca", "wav", "at9"]);
const MOVIE_EXTS = new Set(["usm", "mp4", "webm", "bk2"]);
/** Archives G4PK (paquets de sous-fichiers) — listées par le viewer paquet. */
const PACKAGE_EXTS = new Set(["g4pk", "g4pkm", "g4ra"]);

/** Détermine la famille de preview d'une extension (sans point). */
export function cpkPreviewKind(ext: string): CpkPreviewKind {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (MODEL_EXTS.has(e)) return "model";
  if (SOUND_EXTS.has(e)) return "sound";
  if (MOVIE_EXTS.has(e)) return "movie";
  if (PACKAGE_EXTS.has(e)) return "package";
  if (TEXT_EXTS.has(e)) return "text";
  if (CONFIG_EXTS.has(e)) return "config";
  return "raw";
}

/** Libellé humain d'une famille de preview (badge de la fiche fichier). */
export function previewKindLabel(kind: CpkPreviewKind): string {
  const labels: Record<CpkPreviewKind, string> = {
    image: "Texture",
    model: "Modèle 3D",
    text: "Texte",
    config: "Config binaire",
    sound: "Audio",
    movie: "Vidéo",
    package: "Archive G4PK",
    raw: "Fichier",
  };
  return labels[kind];
}
