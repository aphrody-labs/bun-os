//! Assemblage du modèle 3D complet d'un personnage IEVR.
//!
//! Un personnage est constitué de trois composants qui coexistent dans le même espace monde
//! (coordonnées homogènes issues de la conversion SharpGLTF) :
//!
//! 1. **Corps** (`base_<classe>_NN.glb`) — maille partagée par tous les personnages du même
//!    type corporel (tête/cou/oreilles). Sélectionné via la chaîne
//!    `chara_base → CHARA_BASE_INFO[var[1]=internalCode, var[6]=modelInfoId]`
//!    `→ chara_model → CHARA_MODEL_INFO[var[0]=modelInfoId, var[4]=bodyInfoId]`
//!    `→ CHARA_BODY_INFO[var[0]=bodyInfoId, var[4]=type_idx]`
//!    `→ GLB dx11/model/base_<classe>_NN.glb`.
//!
//! 2. **Visage** (`c<internalCode>.glb`) — maille propre au personnage (yeux, nez, bouche…).
//!    Raccourci : `dx11/model/<internalCode>.glb` (98 % des cas) ; sinon résolution via
//!    `CHARA_MODEL_INFO[var[10]=face_g4md_rel]`.
//!
//! 3. **Uniforme** — sélectionné via la chaîne
//!    `perso.series → season_key → inagle_teams[team_id].kits[season_key] → kit_id`
//!    `→ m_UniformInfoList[nameId=kit_id].modelInfo=[start,count]`
//!    `→ m_UniformModelInfoList[start..start+count][typeId=0]`
//!    `→ uniformKeeperModelIdCrc (si GK) ou uniformFielderModelIdCrc`.
//!    Le CRC obtenu est l'identifiant interne — le GLB correspondant n'est **pas** pré-converti
//!    en dehors des CPK ; son chemin CPK passe par le manifeste CRC→path.
//!
//! ## Résultat
//!
//! [`assemble_character_model`] renvoie un [`AssembledModel`] contenant l'ensemble des
//! [`MeshPrimitive`] des trois composants dans un seul espace monde. La struct est exportable
//! en glTF binaire via [`AssembledModel::to_glb`] (sans textures) ou
//! [`AssembledModel::to_glb_textured`] (avec URI vers le CDN streaming).
//!
//! ## Textures (voie CDN URI — zéro copie de pixels)
//!
//! Les textures G4TX vivent dans les CPK chiffrés (`dx11/chr/_face/`, `dx11/chr/_uniform/`).
//! Le CDN `cdn.rosegriffon.fr` décode les G4TX → PNG à la volée (iecode-cdn:8788, aucun dump).
//!
//! [`to_glb_textured`] génère un GLB avec `images[].uri` pointant vers ces URLs CDN.
//! Three.js/Babylon.js chargent les URI automatiquement. Format de l'URI :
//!
//! - Visage : `https://cdn.rosegriffon.fr/dx11/chr/_face/{series_dir}/{code}/{code}.png`
//! - Uniforme : `https://cdn.rosegriffon.fr/dx11/chr/_uniform/{base_dir}/{tex_name}.png`
//!
//! La résolution du `series_dir` depuis le code interne suit la convention des CPK IEVR :
//! `c01…` → `01_ie1`, `c02…` → `02_ie2`, …, `c11…` → `11_victory`, etc.
//!
//! ## Modèles génériques (keshin / armures)
//!
//! [`assemble_generic_model`] assemble n'importe quelle paire G4MD+G4MG en GLB, sans
//! distinction de composant. Utilisé pour les keshin (`common/chr/_keshin/`) et les armures
//! (`common/chr/_armd/`).
//!
//! ## Skinning — état réel (mesuré le 2026-09-04)
//!
//! L'ancienne note de ce module affirmait que les G4MG n'avaient pas d'attributs de skinning.
//! C'était faux : elle s'appuyait sur le **premier layout** du G4MD lu à un mauvais offset. Les
//! layouts réels (`c01001900`, `u011001`, `sk000101`…) déclarent `WEIGHTS` (vtype 5, 8 × u16
//! UNORM à +0x24) et `INDICES` (vtype 6, 8 × u8 à +0x34), et chaque sous-maille porte une
//! **palette** (`palette_offset`/`palette_len`, +0x3A/+0x3C) dont les slots indexent une table de
//! CRC32 de noms d'os. La résolution est donc : indice local → slot de palette → hachage → os du
//! G4SK par nom ([`Skeleton::bone_by_hash`]). Sur Byron (`c01001900` + `c000101`, 165 os), les
//! sept pièces se résolvent sans aucun os manquant ; `monde_repos · inverse_bind = I` à 2e-7.
//!
//! Ce que le GLB exporte : `skins[0]` (tous les os, `inverseBindMatrices` du G4SK), un nœud par
//! os (TRS local de repos), `JOINTS_0`/`WEIGHTS_0` (+ `_1` si plus de quatre influences). Une
//! pièce sans skinning résolu est émise dans un nœud `<Composant>_static` sans `skin`.
//!
//! Seuls les GLB pré-convertis `dx11/model/` (voie de repli) restent des mailles statiques.
//!
//! ## Limites documentées
//!
//! - **Shader Character** : glTF n'a pas d'équivalent aux rôles `line`, `msk`, `sp`, `spm` ; ils
//!   sont embarqués et déclarés dans `materials[].extras.nie.textures`, seul `oc` est aussi lié
//!   en `occlusionTexture`. La recoloration par masque (`CHARA_PARTS_COLOR`) n'est pas appliquée.
//! - **Corps** : les GLBs `base_*` sont dans l'espace monde via SharpGLTF ; pas de coords locales.
//! - **Coordonnées** : axe Y = haut, unité ≈ mètre. Byron debout : y ∈ [0,0007 ; 1,645].
//!
//! ## Anti-hallucination
//!
//! Toutes les tables (type_idx → GLB, season_key, series_dir depuis code) sont vérifiées sur
//! les données réelles (`chara_body_1.03.49.00.cfg.bin.json`, index Redis `iev:file:index` DB3,
//! `var/model-crc-manifest.ndjson`). Aucune valeur n'est inventée.
//!
//! Compatible `std` (no_std non applicable ici : lecture de fichiers GLB).

extern crate alloc;

use alloc::{string::String, vec::Vec};
use std::path::{Path, PathBuf};

use crate::g4md;
use crate::g4mg;

// ── Constantes de mapping type_idx → nom GLB (issues de chara_body réel) ────

/// Correspondance `type_idx` → suffixe GLB `base_<classe>_NN`.
///
/// Vérifiée sur `CHARA_BODY_INFO_LIST` (76 entrées, data réelle dump VPS).
/// Les type_idx 101 (animal) et 201 (véhicule) n'ont pas de GLB base standard.
pub const TYPE_IDX_TO_GLB: &[(u8, &str)] = &[
    (0, "base_normal_00"),
    (1, "base_normal_01"),
    (2, "base_normal_02"),
    (3, "base_normal_03"),
    (4, "base_tall_00"),
    (5, "base_bigman_00"),
    (6, "base_bigman_01"),
    (7, "base_tall_01"),
    (8, "base_tall_02"),
    (9, "base_tall_03"),
    (10, "base_tall_04"),
    (11, "base_tall_05"),
    (12, "base_big_00"),
    (13, "base_bigwoman_00"),
    (14, "base_small_00"),
    (15, "base_small_01"),
    (16, "base_elderlyman_00"),
    (17, "base_elderlywoman_00"),
    // 101 = animal (_animal/…) — pas de GLB base
    // 201 = vehicle (_item/d…)  — pas de GLB base
];

/// Résout `type_idx` en nom de fichier GLB (sans extension ni chemin).
/// Renvoie `None` pour les types animal/vehicle ou inconnus.
#[must_use]
pub fn type_idx_to_glb_name(type_idx: u8) -> Option<&'static str> {
    TYPE_IDX_TO_GLB
        .iter()
        .find(|(t, _)| *t == type_idx)
        .map(|(_, n)| *n)
}

// ── Clé de saison (season_key) ───────────────────────────────────────────────

/// Clé de kit d'uniforme selon la série du personnage.
///
/// Déduite du champ `series` de `inagle_characters` :
/// - `"Inazuma Eleven"` / `"Inazuma Eleven 2"` → `"ie"`
/// - `"Inazuma Eleven GO"` / `"ARES"` / `"Orion"` / `"Galaxy"` → `"go"`
/// - `"Victory Road"` → `"v"`
/// - Toute autre valeur → `"ie"` par défaut.
///
/// Source de vérité : `inagle_teams.data.kits` (ex. Raimon : `{"ie":"0x252CE113","go":"0xAECB5B3E","v":"0xBBE7C49D"}`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeasonKey {
    /// IE1 / IE2
    Ie,
    /// GO / ARES / Orion / Galaxy
    Go,
    /// Victory Road
    V,
}

impl SeasonKey {
    /// Dérive la clé de saison depuis le champ `series` de `inagle_characters`.
    #[must_use]
    pub fn from_series(series: &str) -> Self {
        let s = series.to_ascii_lowercase();
        if s.contains("victory") {
            Self::V
        } else if s.contains(" go")
            || s.contains("ares")
            || s.contains("orion")
            || s.contains("galaxy")
        {
            Self::Go
        } else {
            Self::Ie
        }
    }

    /// Clé textuelle (`"ie"`, `"go"`, `"v"`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ie => "ie",
            Self::Go => "go",
            Self::V => "v",
        }
    }
}

// ── Résolution du répertoire de série depuis le code interne ─────────────────

/// Résout le répertoire de série (`01_ie1`, `02_ie2`, …) depuis un code interne de personnage.
///
/// Le code interne est de la forme `c<2chiffres><6chiffres>`, par exemple `c01000010`.
/// Les 2 chiffres après le `c` déterminent la série, vérifiés sur l'index `iev:file:index` DB3 :
///
/// | Préfixe | Répertoire    | Série                  |
/// |---------|---------------|------------------------|
/// | `c01`   | `01_ie1`      | Inazuma Eleven 1       |
/// | `c02`   | `02_ie2`      | Inazuma Eleven 2       |
/// | `c03`   | `03_ie3`      | Inazuma Eleven 3       |
/// | `c04`   | `04_go1`      | IE GO 1                |
/// | `c05`   | `05_go2`      | IE GO 2                |
/// | `c06`   | `06_go3`      | IE GO 3                |
/// | `c07`   | `07_ares`     | IE Ares no Tenbin      |
/// | `c08`   | `08_orion`    | IE Orion no Kokuin     |
/// | `c11`   | `11_victory`  | IE Victory Road        |
/// | `c20`   | `20_edit`     | Personnage éditeur     |
/// | `c21`   | `21_mannequin`| Mannequin              |
/// | `c22`   | `22_combo`    | Combo                  |
///
/// Retourne `None` si le code ne commence pas par `c` ou si le préfixe de 2 chiffres est inconnu.
#[must_use]
pub fn series_dir_from_code(internal_code: &str) -> Option<&'static str> {
    // Le code commence par 'c' puis 2 chiffres de série.
    let digits = internal_code.strip_prefix('c')?;
    let prefix: &str = digits.get(..2)?;
    match prefix {
        "01" => Some("01_ie1"),
        "02" => Some("02_ie2"),
        "03" => Some("03_ie3"),
        "04" => Some("04_go1"),
        "05" => Some("05_go2"),
        "06" => Some("06_go3"),
        "07" => Some("07_ares"),
        "08" => Some("08_orion"),
        "11" => Some("11_victory"),
        "20" => Some("20_edit"),
        "21" => Some("21_mannequin"),
        "22" => Some("22_combo"),
        "99" => {
            if digits == "99019010" {
                Some("01_ie1")
            } else if digits == "99019020" {
                Some("11_victory")
            } else {
                None
            }
        }
        _ => None,
    }
}

// ── Résolution des URI de textures CDN ───────────────────────────────────────

/// Préfixe de base de l'URL CDN pour les textures.
///
/// Peut être surchargé via [`TextureUriConfig`] pour pointer vers un CDN alternatif.
pub const CDN_BASE: &str = "https://cdn.rosegriffon.fr";

/// Configuration des URI de textures (permet de surcharger le CDN de base en test).
#[derive(Debug, Clone)]
pub struct TextureUriConfig {
    /// Préfixe CDN (défaut : variable d'environnement `NIE_CDN_BASE`, sinon [`CDN_BASE`]).
    pub cdn_base: String,
}

impl Default for TextureUriConfig {
    fn default() -> Self {
        Self {
            cdn_base: std::env::var("NIE_CDN_BASE")
                .ok()
                .map(|v| v.trim().trim_end_matches('/').to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| CDN_BASE.to_string()),
        }
    }
}

/// Résout l'URI CDN d'une texture de **visage** depuis le code interne du personnage.
///
/// Chemin : `{cdn_base}/dx11/chr/_face/{series_dir}/{code}/{code}.png`
///
/// Retourne `None` si `internal_code` ne correspond à aucune série connue.
///
/// # Exemple
///
/// ```
/// use aphrody_nie_formats::assemble::{face_texture_uri, TextureUriConfig};
/// let cfg = TextureUriConfig::default();
/// let uri = face_texture_uri("c01000010", &cfg).unwrap();
/// assert_eq!(uri, "https://cdn.rosegriffon.fr/dx11/chr/_face/01_ie1/c01000010/c01000010.png");
/// ```
#[must_use]
pub fn face_texture_uri(internal_code: &str, cfg: &TextureUriConfig) -> Option<String> {
    let dir = series_dir_from_code(internal_code)?;
    Some(alloc::format!(
        "{}/dx11/chr/_face/{}/{}/{}.png",
        cfg.cdn_base,
        dir,
        internal_code,
        internal_code
    ))
}

/// Résout l'URI CDN d'une texture d'**uniforme** depuis le nom de base du matériau.
///
/// Le `material_base_name` est extrait du G4MD (`material_base_names[i]`) et correspond
/// au nom du répertoire d'uniforme (ex. `sk000901`, `u011001`, `f001202`).
/// La texture principale est `{base_name}_10.g4tx` (suffixe `_10` = couleur principale, vérifié
/// sur l'index iev:file:index DB3 pour plusieurs uniformes). Si `_10` est absent, on essaie
/// la texture sans suffixe.
///
/// Chemin : `{cdn_base}/dx11/chr/_uniform/{base_name}/{base_name}_10.png`
///
/// # Exemple
///
/// ```
/// use aphrody_nie_formats::assemble::{uniform_texture_uri, TextureUriConfig};
/// let cfg = TextureUriConfig::default();
/// let uri = uniform_texture_uri("sk000901", &cfg);
/// assert_eq!(uri, "https://cdn.rosegriffon.fr/dx11/chr/_uniform/sk000901/sk000901_10.png");
/// ```
#[must_use]
pub fn uniform_texture_uri(material_base_name: &str, cfg: &TextureUriConfig) -> String {
    alloc::format!(
        "{}/dx11/chr/_uniform/{}/{}_10.png",
        cfg.cdn_base,
        material_base_name,
        material_base_name
    )
}

// ── Textures de l'éditeur d'avatar ────────────────────────────────────────────

/// Racine VFS des textures de l'éditeur d'avatar.
pub const AVATAR_TEX_ROOT: &str = "data/dx11/chr/_face/20_EDIT";

/// Chemins VFS candidats du conteneur `.g4tx` d'une pièce de l'éditeur, dans l'ordre d'essai.
///
/// Les modèles vivent sous `common/chr/_face/20_EDIT/<dossier>/<nom>.g4md`, les textures sous
/// `dx11/chr/_face/20_EDIT/` — un arbre **parallèle mais pas identique**, et c'est ce décalage qui
/// met en échec toute résolution par nom de matériau :
///
/// | dossier du modèle | conteneur de texture | remarque |
/// |---|---|---|
/// | `_hairF` / `_hairB` / `_hairU` | `<dossier>/<nom>M.g4tx` | suffixe `M`, mesuré 62/63, 52/54, 44/45 |
/// | `_base` | `_base/<nom>.g4tx` | sans `M` (0/18 en forme `M`) |
/// | `_facebase` | `_facebase/_facebase.g4tx` | **un seul** fichier pour les 64 modèles |
/// | `_accessory` | `_accessorytex/accessory_10.g4tx` | **un seul** fichier pour les 44 modèles |
/// | `_ear` | — | aucune texture propre |
///
/// La forme sans `M` est toujours essayée en repli : elle existe pour une partie de `_base`.
#[must_use]
pub fn avatar_texture_candidates(dossier: &str, nom: &str) -> Vec<alloc::string::String> {
    match dossier {
        "_facebase" => {
            alloc::vec![alloc::format!("{AVATAR_TEX_ROOT}/_facebase/_facebase.g4tx")]
        }
        "_accessory" => {
            alloc::vec![alloc::format!(
                "{AVATAR_TEX_ROOT}/_accessorytex/accessory_10.g4tx"
            )]
        }
        "_ear" => alloc::vec![],
        _ => alloc::vec![
            alloc::format!("{AVATAR_TEX_ROOT}/{dossier}/{nom}M.g4tx"),
            alloc::format!("{AVATAR_TEX_ROOT}/{dossier}/{nom}.g4tx"),
        ],
    }
}

/// Chemin VFS du conteneur de texture d'une pièce d'**uniforme** (haut, short, chaussures).
///
/// Piège : le conteneur porte l'identifiant de la **tenue**, pas celui du modèle. La tenue de
/// l'éditeur est `u117401_10` pour le haut et `s117401_10` pour les chaussures — noms lus dans les
/// recettes `common/chr/_test/default/mdl_edit_avatar*.cfg.bin` — alors que les modèles sont
/// `u000101` et `s000201`. Le fichier `u000101/u117401_10.g4tx` contient les textures nommées
/// `u000101_20` et `u000101_30`.
#[must_use]
pub fn uniform_texture_vfs_path(dossier_modele: &str, tenue: &str) -> alloc::string::String {
    alloc::format!("data/dx11/chr/_uniform/{dossier_modele}/{tenue}.g4tx")
}

/// Nom de la texture à décoder dans le conteneur, déduit du nom de matériau du G4MD.
///
/// Les matériaux d'uniforme portent un suffixe de niveau de détail (`u000101_30_LOD1`) que le nom
/// de la texture n'a pas (`u000101_30`). Les matériaux de l'éditeur, eux, nomment déjà la texture.
#[must_use]
pub fn avatar_texture_name(material_name: &str) -> &str {
    let mut fin = material_name;
    while let Some(pos) = fin.rfind("_LOD") {
        if fin[pos + 4..].chars().all(|c| c.is_ascii_digit()) && pos + 4 < fin.len() {
            fin = &fin[..pos];
        } else {
            break;
        }
    }
    fin
}

// ── Position sur le terrain ───────────────────────────────────────────────────

/// Position du joueur sur le terrain (pour le choix keeper vs fielder).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldPosition {
    /// Gardien de but.
    Goalkeeper,
    /// Joueur de champ (attaquant, milieu, défenseur).
    Fielder,
    /// Entraîneur.
    Manager,
    /// Directeur (type special).
    Director,
}

// ── Règles de matching (vérifiées sur données réelles) ───────────────────────

/// Résultat du matching d'uniforme : CRC du modèle GLB dans les CPK.
#[derive(Debug, Clone)]
pub struct UniformModelCrc {
    /// CRC32 du modèle uniforme (clé dans les CPK `common/chr/_uniform/`).
    pub crc: u32,
    /// Position utilisée pour le choix.
    pub position: FieldPosition,
}

/// Paramètres de sélection du modèle uniforme depuis `inagle_uniforms`.
///
/// Les champs correspondent directement aux colonnes de la table SQL et au JSON `models`.
#[derive(Debug, Clone)]
pub struct UniformModelEntry {
    /// `typeId` dans `models[*]` (0 = standard, 1 = variante météo/courtes manches, …).
    pub type_id: u8,
    /// CRC du modèle fielder (`uniformFielderModelIdCrc`).
    pub fielder_crc: u32,
    /// CRC du modèle keeper (`uniformKeeperModelIdCrc`).
    pub keeper_crc: u32,
}

impl UniformModelEntry {
    /// Sélectionne le CRC approprié pour la position donnée.
    #[must_use]
    pub fn crc_for_position(&self, pos: FieldPosition) -> u32 {
        match pos {
            FieldPosition::Goalkeeper => self.keeper_crc,
            _ => self.fielder_crc,
        }
    }
}

// ── Primitive de maille ───────────────────────────────────────────────────────

/// Composant source d'un primitive (pour traçabilité).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeshComponent {
    /// Maille de base (corps/tête partagée).
    Body,
    /// Maille du visage (propre au personnage).
    Face,
    /// Maille de l'uniforme.
    Uniform,
    /// Keshin (`common/chr/_keshin/`).
    Keshin,
    /// Armure (`common/chr/_armd/`).
    Armed,
    /// Modèle générique (autre catégorie).
    Generic,
}

/// Primitive de maille décodée, prête pour l'export glTF.
///
/// Un personnage complet = plusieurs `MeshPrimitive` (une par sous-maille de chaque composant).
/// L'index de base des vertices est **local** à cette primitive (commence toujours à 0).
#[derive(Debug, Clone)]
pub struct MeshPrimitive {
    /// Composant d'origine.
    pub component: MeshComponent,
    /// Index de la primitive dans le composant source.
    pub source_index: usize,
    /// Index de matériau (local à la primitive).
    pub material_index: u8,
    /// Nom de texture base-color issu du G4MD (ex. `c01000010`, `sk000901`).
    /// Vide pour les primitives issues de GLBs pré-convertis (matériau `Default`).
    pub material_name: String,
    /// URI CDN résolue de la texture baseColorTexture.
    /// Vide si la résolution n'a pas pu aboutir (matériau générique ou G4MD non parsé).
    /// Renseigné par [`AssembledModel::resolve_texture_uris`].
    pub texture_uri: String,
    /// Positions float3 (X, Y, Z) dans l'espace monde.
    pub positions: Vec<g4mg::Vec3>,
    /// Normales float3 (renormalisées). Vide si non disponibles.
    pub normals: Vec<g4mg::Vec3>,
    /// UV0 float2 (U, V). Vide si non disponibles.
    pub uv0: Vec<g4mg::Vec2>,
    /// Couleurs float4 (R, G, B, A). Vide si non disponibles.
    pub colors: Vec<g4mg::Vec4>,
    /// Indices u32 locaux (commencent à 0).
    pub indices: Vec<u32>,
    /// Skinning résolu contre le squelette du modèle (indices d'os **globaux**). `None` pour
    /// une maille statique (GLB pré-converti, pièce sans `BLENDWEIGHT`, ou squelette absent).
    pub skin: Option<PrimitiveSkin>,
    /// Nom de la pièce d'origine (`c01001900`, `u011001`, `sk000101`…), pour la traçabilité.
    pub piece: String,
}

impl MeshPrimitive {
    /// Nombre de vertices.
    #[must_use]
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// Nombre de triangles (indices / 3).
    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

// ── Skinning ─────────────────────────────────────────────────────────────────

/// Influences d'os par vertex, indices **globaux** dans [`Skeleton::bones`].
///
/// Jusqu'à huit influences par vertex, telles que stockées dans le G4MG (`8× u16 UNORM` +
/// `8× u8`). Une influence nulle a un poids 0 et un os 0. Les poids d'un vertex somment à 1
/// après renormalisation des seules influences résolues.
#[derive(Debug, Clone, Default)]
pub struct PrimitiveSkin {
    /// Indices d'os globaux, par vertex.
    pub joints: Vec<[u16; 8]>,
    /// Poids, par vertex.
    pub weights: Vec<[f32; 8]>,
}

impl PrimitiveSkin {
    /// Nombre maximal d'influences non nulles sur un vertex.
    #[must_use]
    pub fn max_influences(&self) -> usize {
        self.weights
            .iter()
            .map(|w| w.iter().filter(|x| **x > 0.0).count())
            .max()
            .unwrap_or(0)
    }

    /// Os globaux effectivement pondérés, triés.
    #[must_use]
    pub fn bones_used(&self) -> Vec<u16> {
        let mut set = std::collections::BTreeSet::new();
        for (j, w) in self.joints.iter().zip(&self.weights) {
            for k in 0..8 {
                if w[k] > 0.0 {
                    set.insert(j[k]);
                }
            }
        }
        set.into_iter().collect()
    }
}

/// Un os du squelette assemblé.
#[derive(Debug, Clone)]
pub struct SkeletonBone {
    /// Nom de l'os (`c_head_1_0`…).
    pub name: String,
    /// CRC32 IEEE du nom — ce que les tables de palette G4MD référencent.
    pub hash: u32,
    /// Parent, `None` pour une racine.
    pub parent: Option<usize>,
    /// Pose locale de repos (TRS relatif au parent).
    pub local: crate::g4sk::LocalTrs,
    /// Matrice inverse-bind 4×4 col-major.
    pub inverse_bind: [[f32; 4]; 4],
}

/// Squelette d'un personnage, lu dans son G4SK.
#[derive(Debug, Clone)]
pub struct Skeleton {
    /// Chemin VFS ou nom d'origine du G4SK.
    pub source: String,
    /// Os dans l'ordre du fichier (profondeur croissante : un parent précède ses enfants).
    pub bones: Vec<SkeletonBone>,
}

impl Skeleton {
    /// Lit un G4SK complet : hiérarchie réelle (table d'offsets), poses locales et matrices
    /// inverse-bind.
    ///
    /// # Erreurs
    ///
    /// [`AssembleError::Format`] si l'en-tête est invalide ; [`AssembleError::Corrupt`] si la
    /// hiérarchie n'est pas résolue de façon fiable (heuristique C#) ou si les poses manquent —
    /// on refuse de skinner sur un squelette deviné.
    pub fn from_g4sk(source: &str, data: &[u8]) -> Result<Self, AssembleError> {
        let header = crate::g4sk::parse_header(data)?;
        let hier = crate::g4sk::parse_hierarchy(data, &header);
        if hier.heuristic {
            return Err(AssembleError::Corrupt(format!(
                "{source} : hiérarchie d'os non résolue (table d'offsets invalide)"
            )));
        }
        let poses = crate::g4sk::parse_poses(data, &header).ok_or_else(|| {
            AssembleError::Corrupt(format!("{source} : poses de bind illisibles"))
        })?;
        if poses.len() != hier.bones.len() {
            return Err(AssembleError::Corrupt(format!(
                "{source} : {} os mais {} poses",
                hier.bones.len(),
                poses.len()
            )));
        }
        let bones = hier
            .bones
            .iter()
            .zip(poses)
            .enumerate()
            .map(|(i, (b, p))| SkeletonBone {
                name: b.name.clone(),
                hash: crate::cfgbin::crc32(b.name.as_bytes()),
                parent: usize::try_from(b.parent_index).ok().filter(|&p| p < i),
                local: p.local,
                inverse_bind: p.inverse_bind,
            })
            .collect();
        Ok(Self {
            source: source.to_string(),
            bones,
        })
    }

    /// Index d'un os par hachage de nom.
    #[must_use]
    pub fn bone_by_hash(&self, hash: u32) -> Option<usize> {
        self.bones.iter().position(|b| b.hash == hash)
    }

    /// Index d'un os par nom.
    #[must_use]
    pub fn bone_by_name(&self, name: &str) -> Option<usize> {
        self.bones.iter().position(|b| b.name == name)
    }

    /// Matrices monde de repos, par cinématique directe.
    #[must_use]
    pub fn rest_world(&self) -> Vec<[[f32; 4]; 4]> {
        let mut world: Vec<[[f32; 4]; 4]> = Vec::with_capacity(self.bones.len());
        for b in &self.bones {
            let local = crate::g4sk::local_matrix(&b.local);
            let m = match b.parent {
                Some(p) => crate::g4sk::mat_mul(&world[p], &local),
                None => local,
            };
            world.push(m);
        }
        world
    }

    /// Écart maximal `|monde_repos · inverse_bind − I|` sur tous les os : proche de 0 si les
    /// matrices inverse-bind correspondent bien à la pose de repos (donc si un GLB `skins`
    /// construit avec les deux est cohérent).
    #[must_use]
    pub fn bind_consistency_error(&self) -> f32 {
        let world = self.rest_world();
        let mut worst = 0.0f32;
        for (w, b) in world.iter().zip(&self.bones) {
            let m = crate::g4sk::mat_mul(w, &b.inverse_bind);
            for (c, col) in m.iter().enumerate() {
                for (r, v) in col.iter().enumerate() {
                    let expected = if r == c { 1.0 } else { 0.0 };
                    worst = worst.max((v - expected).abs());
                }
            }
        }
        worst
    }
}

/// Bilan de la résolution du skinning d'une pièce.
#[derive(Debug, Clone, Default)]
pub struct SkinDiagnostic {
    /// Sous-mailles skinnées avec au moins un os résolu.
    pub skinned_submeshes: usize,
    /// Sous-mailles sans attributs de skinning.
    pub static_submeshes: usize,
    /// Slots de palette dont le hachage ne nomme aucun os du squelette (dédoublonnés).
    pub unresolved_hashes: Vec<u32>,
    /// Vertices dont toutes les influences ont été perdues (aucun os résolu).
    pub vertices_without_bone: usize,
    /// Os globaux utilisés (dédoublonnés, triés).
    pub bones_used: Vec<u16>,
}

/// Résout le skinning d'une sous-maille : indices locaux → slots de palette → hachages → os du
/// squelette. Les influences non résolues sont abandonnées et les poids restants renormalisés ;
/// le bilan en garde la trace plutôt que de les réattribuer à un os arbitraire.
fn resolve_submesh_skin(
    g4mg: &[u8],
    md: &g4md::G4md,
    index: usize,
    skeleton: &Skeleton,
    diag: &mut SkinDiagnostic,
) -> Option<PrimitiveSkin> {
    let sm = md.submeshes.get(index)?;
    let raw = g4mg::extract_skin(g4mg, md, index)?;
    let palette = md.palette_of(sm);
    if palette.is_empty() {
        return None;
    }
    // Table locale → os global, calculée une fois par sous-maille.
    let lookup: Vec<Option<u16>> = palette
        .iter()
        .map(|&slot| {
            let hash = md.joint_hashes.get(slot as usize).copied()?;
            match skeleton.bone_by_hash(hash) {
                Some(b) => u16::try_from(b).ok(),
                None => {
                    if !diag.unresolved_hashes.contains(&hash) {
                        diag.unresolved_hashes.push(hash);
                    }
                    None
                }
            }
        })
        .collect();
    if lookup.iter().all(Option::is_none) {
        return None;
    }
    let mut joints = Vec::with_capacity(raw.len());
    let mut weights = Vec::with_capacity(raw.len());
    for v in &raw {
        let mut j = [0u16; 8];
        let mut w = [0f32; 8];
        let mut n = 0usize;
        for k in 0..8 {
            if v.weights[k] <= 0.0 {
                continue;
            }
            let Some(Some(bone)) = lookup.get(v.bones[k] as usize) else {
                continue;
            };
            j[n] = *bone;
            w[n] = v.weights[k];
            n += 1;
        }
        let total: f32 = w.iter().sum();
        if total > 0.0 {
            for x in &mut w {
                *x /= total;
            }
        } else {
            diag.vertices_without_bone += 1;
        }
        joints.push(j);
        weights.push(w);
    }
    let skin = PrimitiveSkin { joints, weights };
    for b in skin.bones_used() {
        if let Err(pos) = diag.bones_used.binary_search(&b) {
            diag.bones_used.insert(pos, b);
        }
    }
    diag.skinned_submeshes += 1;
    Some(skin)
}

// ── Modèle assemblé ──────────────────────────────────────────────────────────

/// Texture embarquée dans le GLB (données PNG brutes à injecter dans le buffer BIN).
///
/// Permet d'embarquer des textures PNG directement dans le GLB au lieu d'utiliser
/// des URI externes (CDN). Plus autonome, fonctionne sans réseau.
#[derive(Debug, Clone)]
pub struct EmbeddedTexture {
    /// Composant associé (Face, Uniform, etc.) — pour l'attribution aux primitives.
    pub component: MeshComponent,
    /// Nom logique de la texture (ex. `"c01000010"`, `"u011001"`).
    pub name: String,
    /// Données PNG brutes (encodées, prêtes pour l'injection dans le bufferView BIN).
    pub png_bytes: Vec<u8>,
}

/// Résultat de l'assemblage : ensemble des primitives de tous les composants.
///
/// ## Export glTF
///
/// - [`AssembledModel::to_glb`] — GLB sans textures (matériaux PBR generiques sans image).
/// - [`AssembledModel::to_glb_textured`] — GLB avec `images[].uri` pointant vers le CDN
///   IEVR (iecode-cdn:8788 décode les G4TX → PNG en live depuis les CPK).
/// - [`AssembledModel::to_glb_embedded`] — GLB avec textures PNG **embarquées** dans le
///   buffer BIN (autonome, aucune dépendance réseau). Utilise [`EmbeddedTexture`].
///
/// Chaque composant (corps / visage / uniforme / keshin / armure / generique) devient un
/// noeud glTF séparé avec son propre mesh.
#[derive(Debug)]
pub struct AssembledModel {
    /// Identifiant interne (ex. `"c01000010"` pour perso, `"k000010"` pour keshin).
    pub internal_code: String,
    /// Nom de fichier GLB du corps (ex. `"base_normal_00"`). Vide pour modèles génériques.
    pub body_glb: String,
    /// Nom de fichier GLB du visage (ex. `"c01000010"`). Vide pour modèles génériques.
    pub face_glb: String,
    /// CRC de l'uniforme sélectionné (`0` si non résolu ou modèle générique).
    pub uniform_crc: u32,
    /// Toutes les primitives.
    pub primitives: Vec<MeshPrimitive>,
    /// Textures PNG à embarquer dans le GLB (renseigné par le service avant export).
    pub embedded_textures: Vec<EmbeddedTexture>,
    /// Squelette lié, si au moins une primitive est skinnée. Exporté en `skins`/`joints` glTF.
    pub skeleton: Option<Skeleton>,
    /// Textures auxiliaires du shader Character (`line`, `msk`, `oc`, `sp`, `spm`) par matériau.
    /// glTF n'a pas d'équivalent pour la plupart : elles sont embarquées et déclarées dans
    /// `materials[].extras.nie` ; seul le rôle `occlusion` est aussi lié en `occlusionTexture`.
    pub aux_textures: Vec<AuxTexture>,
    /// Rapport d'assemblage machine-readable (pièces, sources, matériaux, skinning).
    pub report: serde_json::Value,
    /// Vrai : une primitive dont le nom de matériau n'a pas de texture embarquée reçoit le
    /// matériau `Default`, jamais la première texture de son composant. C'est le régime des
    /// personnages, où chaque pièce a ses propres planches : appliquer la texture du haut aux
    /// bras parce qu'ils sont tous deux `Uniform` est exactement l'erreur à éviter.
    pub strict_materials: bool,
    /// Clips de mouvement déjà décodés et résolus contre `skeleton`, à écrire en `animations`
    /// glTF. Vide par défaut : un GLB sans requête d'animation explicite du service n'en gagne
    /// aucune — le contrat d'octets existant (galerie, vignettes) ne change pas sous les pieds
    /// d'un appelant qui n'a rien demandé. [`crate::g4mt::Motion::decode_clip`] refuse déjà les
    /// clips additifs en amont : ce champ ne peut donc contenir que des clips non additifs.
    pub animation_clips: Vec<crate::g4mt::DecodedMotionClip>,
    /// Clips demandés par l'appelant mais volontairement absents de `animation_clips`, avec la
    /// raison. Écrit dans `extras.nie.animation.excluded` du GLB — jamais mélangé en silence aux
    /// clips retenus. Le cas principal est `additive` (glTF n'a pas de canal « relatif à une pose
    /// de base » sans une extension que ce dépôt n'implémente pas), mais un nom introuvable ou un
    /// clip qui ne résout aucune piste contre ce squelette atterrit ici aussi.
    pub animation_excluded: Vec<AnimationExclusion>,
}

/// Un clip demandé mais non embarqué dans le GLB, avec sa raison — jamais un clip silencieusement
/// jeté. Voir [`AssembledModel::animation_excluded`].
#[derive(Debug, Clone)]
pub struct AnimationExclusion {
    /// Nom du clip tel que nommé dans le `.g4mt` source.
    pub name: String,
    /// Raison humaine, courte, qui finit telle quelle dans `extras.nie.animation.excluded[].reason`.
    pub reason: String,
}

/// Texture auxiliaire d'un matériau (rôle non représentable en PBR de base).
#[derive(Debug, Clone)]
pub struct AuxTexture {
    /// Nom du matériau cible (tel que `MeshPrimitive::material_name`).
    pub material: String,
    /// Rôle : `line`, `mask`, `occlusion`, `specular`, `specular_mask`.
    pub role: String,
    /// Nom de la texture dans son conteneur G4TX (`u011001_20oc`…).
    pub name: String,
    /// PNG encodé.
    pub png_bytes: Vec<u8>,
}

/// Rôle d'une texture G4TX déduit de son suffixe, comme le fait l'add-on Blender
/// (`texture_usage_from_name`) : `line`, `msk`, `oc`, `sp`, `spm`, sinon `base`.
#[must_use]
pub fn texture_role_from_name(name: &str) -> (&str, &'static str) {
    let lower_len = name.len();
    let lower = name.to_ascii_lowercase();
    for (suffix, role) in [
        ("line", "line"),
        ("msk", "mask"),
        ("spm", "specular_mask"),
        ("sp", "specular"),
        ("oc", "occlusion"),
    ] {
        if lower.ends_with(suffix) && lower_len > suffix.len() {
            return (&name[..lower_len - suffix.len()], role);
        }
    }
    (name, "base")
}

impl AssembledModel {
    /// Nombre total de vertices.
    #[must_use]
    pub fn total_vertex_count(&self) -> usize {
        self.primitives
            .iter()
            .map(MeshPrimitive::vertex_count)
            .sum()
    }

    /// Nombre total de triangles.
    #[must_use]
    pub fn total_triangle_count(&self) -> usize {
        self.primitives
            .iter()
            .map(MeshPrimitive::triangle_count)
            .sum()
    }

    /// Primitives appartenant au corps.
    pub fn body_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives
            .iter()
            .filter(|p| p.component == MeshComponent::Body)
    }

    /// Primitives appartenant au visage.
    pub fn face_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives
            .iter()
            .filter(|p| p.component == MeshComponent::Face)
    }

    /// Primitives appartenant à l'uniforme.
    pub fn uniform_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives
            .iter()
            .filter(|p| p.component == MeshComponent::Uniform)
    }

    /// Primitives appartenant au keshin.
    pub fn keshin_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives
            .iter()
            .filter(|p| p.component == MeshComponent::Keshin)
    }

    /// Primitives appartenant à une armure (armed).
    pub fn armed_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives
            .iter()
            .filter(|p| p.component == MeshComponent::Armed)
    }

    /// Résout les URI de textures CDN pour toutes les primitives qui ont un `material_name`.
    ///
    /// Met à jour `primitive.texture_uri` en place pour les primitives issues de G4MD/G4MG
    /// (celles dont `material_name` est non vide). Les primitives issues de GLBs pré-convertis
    /// gardent `texture_uri = ""` (matériau `Default` sans texture).
    ///
    /// Utilise `internal_code` du modèle pour résoudre le répertoire de série du visage.
    pub fn resolve_texture_uris(&mut self, cfg: &TextureUriConfig) {
        let face_uri = face_texture_uri(&self.internal_code, cfg);
        for prim in &mut self.primitives {
            if prim.material_name.is_empty() {
                continue;
            }
            prim.texture_uri = match prim.component {
                MeshComponent::Face => face_uri.clone().unwrap_or_default(),
                MeshComponent::Uniform => uniform_texture_uri(&prim.material_name, cfg),
                MeshComponent::Keshin | MeshComponent::Armed | MeshComponent::Generic => {
                    // Keshin/armure : même répertoire que le modèle dans dx11/chr
                    // Pas de textures dx11 spécifiques pour ces composants dans l'index actuel.
                    // On laisse vide — les textures seront servies par @cpk_live si présentes.
                    String::new()
                }
                MeshComponent::Body => String::new(), // GLB pré-converti : pas de material_name G4MD
            };
        }
    }

    /// Exporte le modèle assemblé en glTF binaire (GLB 2.0) **sans textures**.
    ///
    /// Matériaux generiques `Default` (PBR metallic-roughness, couleur blanche, sans image).
    /// Utile pour le debug ou quand le CDN n'est pas disponible.
    #[must_use]
    pub fn to_glb(&self) -> Vec<u8> {
        build_glb(self, false)
    }

    /// Exporte le modèle assemblé en glTF binaire (GLB 2.0) **avec URI CDN** vers les textures.
    ///
    /// Résout automatiquement les URI CDN via [`resolve_texture_uris`] (appel idempotent) si
    /// les URI ne sont pas déjà renseignées. Les textures sont référencées par URI externe
    /// (pas embarquées dans le GLB) — elles sont streamées depuis le CDN lors du chargement.
    ///
    /// [`resolve_texture_uris`] doit avoir été appelé (ou appelez cette méthode qui le fait
    /// automatiquement si les URI sont vides).
    #[must_use]
    pub fn to_glb_textured(&mut self, cfg: &TextureUriConfig) -> Vec<u8> {
        // Résout les URI si pas encore fait.
        let needs_resolve = self.primitives.iter().all(|p| p.texture_uri.is_empty());
        if needs_resolve {
            self.resolve_texture_uris(cfg);
        }
        build_glb(self, true)
    }

    /// Exporte le modèle assemblé en glTF binaire (GLB 2.0) **avec textures PNG embarquées**
    /// dans le buffer BIN (autonome, aucune dépendance réseau).
    ///
    /// Les textures dans [`AssembledModel::embedded_textures`] sont injectées comme
    /// `bufferView` dans le BIN chunk du GLB. Le matériau de chaque composant est mis à jour
    /// pour pointer vers la bonne image.
    ///
    /// Les primitives issues de GLBs pré-convertis (Body) gardent le matériau Default.
    /// Les primitives issues de G4MD/G4MG (Face, Uniform depuis CPK) utilisent les textures
    /// embarquées si disponibles.
    ///
    /// Si [`embedded_textures`] est vide, équivaut à [`to_glb`] (matériaux Default).
    #[must_use]
    pub fn to_glb_embedded(&self) -> Vec<u8> {
        build_glb_embedded(self)
    }
}

// ── Erreurs d'assemblage ──────────────────────────────────────────────────────

/// Erreur lors de l'assemblage d'un personnage.
#[derive(Debug)]
pub enum AssembleError {
    /// Lecture du fichier GLB impossible.
    GlbNotFound(String),
    /// Données G4MD/G4MG invalides.
    Format(crate::FormatError),
    /// Le type corporel n'a pas de GLB base correspondant.
    NoBaseGlb(u8),
    /// Données GLB corrompues (JSON invalide ou buffer manquant).
    Corrupt(String),
}

// Display + Error + From MANUELS (no_std-ready via `core::error::Error`) — `thiserror` retiré (Phase 3 dédup).
impl core::fmt::Display for AssembleError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::GlbNotFound(s) => write!(f, "fichier GLB introuvable ou illisible : {s}"),
            Self::Format(e) => write!(f, "format invalide : {e}"),
            Self::NoBaseGlb(i) => write!(f, "type_idx={i} sans GLB base (animal/vehicle/inconnu)"),
            Self::Corrupt(s) => write!(f, "GLB corrompu : {s}"),
        }
    }
}

impl core::error::Error for AssembleError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Format(e) => Some(e),
            _ => None,
        }
    }
}

impl From<crate::FormatError> for AssembleError {
    fn from(e: crate::FormatError) -> Self {
        Self::Format(e)
    }
}

// ── Lecture GLB ──────────────────────────────────────────────────────────────

/// Données extraites d'un GLB (JSON glTF + buffer binaire).
struct GlbData {
    gltf_json: serde_json::Value,
    bin_buffer: Vec<u8>,
}

/// Lit un fichier `.glb` et renvoie le JSON glTF + le buffer binaire.
fn read_glb(path: &Path) -> Result<GlbData, AssembleError> {
    let data =
        std::fs::read(path).map_err(|_| AssembleError::GlbNotFound(path.display().to_string()))?;

    if data.len() < 12 {
        return Err(AssembleError::Corrupt("GLB trop court".into()));
    }
    // Magic 0x46546c67 = "glTF"
    let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if magic != 0x46546C67 {
        return Err(AssembleError::Corrupt(format!(
            "magic GLB invalide : {magic:#010x}"
        )));
    }

    let mut offset = 12usize;
    let mut json_bytes: Option<Vec<u8>> = None;
    let mut bin_buffer: Vec<u8> = Vec::new();

    while offset + 8 <= data.len() {
        let chunk_len = u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let chunk_type = u32::from_le_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);
        let chunk_end = offset + 8 + chunk_len;
        if chunk_end > data.len() {
            break;
        }
        let chunk_data = &data[offset + 8..chunk_end];
        match chunk_type {
            0x4E4F534A => {
                // JSON
                json_bytes = Some(chunk_data.to_vec());
            }
            0x004E4942 => {
                // BIN
                bin_buffer = chunk_data.to_vec();
            }
            _ => {}
        }
        offset = chunk_end;
    }

    let json_bytes =
        json_bytes.ok_or_else(|| AssembleError::Corrupt("chunk JSON absent".into()))?;

    // Retire le padding NUL de fin (GLB spec : padding 0x20 ou 0x00).
    let json_str_bytes: Vec<u8> = json_bytes.into_iter().filter(|&b| b != 0x00).collect();

    let gltf_json: serde_json::Value = serde_json::from_slice(&json_str_bytes)
        .map_err(|e| AssembleError::Corrupt(format!("JSON GLB invalide : {e}")))?;

    Ok(GlbData {
        gltf_json,
        bin_buffer,
    })
}

/// Extrait toutes les primitives d'un GLB et les convertit en [`MeshPrimitive`].
///
/// Chaque primitive glTF (POSITION + NORMAL + TEXCOORD_0 + indices) devient une [`MeshPrimitive`].
fn extract_primitives_from_glb(
    glb: &GlbData,
    component: MeshComponent,
) -> Result<Vec<MeshPrimitive>, AssembleError> {
    let json = &glb.gltf_json;
    let bin = &glb.bin_buffer;

    let empty_arr: Vec<serde_json::Value> = Vec::new();
    let meshes = json["meshes"].as_array().unwrap_or(&empty_arr);
    let accessors = json["accessors"].as_array().unwrap_or(&empty_arr);
    let buffer_views = json["bufferViews"].as_array().unwrap_or(&empty_arr);

    let mut out = Vec::new();
    let mut global_prim_idx = 0usize;

    for mesh in meshes {
        let primitives = mesh["primitives"].as_array().unwrap_or(&empty_arr);
        for prim in primitives {
            let attrs = &prim["attributes"];

            // Matériau
            let mat_idx = prim["material"].as_u64().unwrap_or(0) as u8;
            let mat_name = String::new(); // résolution texture non implémentée ici

            // Helper : lit un accessor dans bin_buffer.
            let read_accessor = |acc_idx: usize| -> Option<(usize, usize, usize)> {
                let acc = accessors.get(acc_idx)?;
                let bv_idx = acc["bufferView"].as_u64()? as usize;
                let bv = buffer_views.get(bv_idx)?;
                let bv_offset = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
                let bv_stride = bv["byteStride"].as_u64().unwrap_or(0) as usize;
                let acc_offset = acc["byteOffset"].as_u64().unwrap_or(0) as usize;
                let count = acc["count"].as_u64()? as usize;
                Some((bv_offset + acc_offset, bv_stride, count))
            };

            // Positions (VEC3 float32).
            let positions = if let Some(pos_idx) = attrs["POSITION"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(pos_idx as usize) {
                    let stride = if stride_hint == 0 { 12 } else { stride_hint };
                    let mut pos = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + 12 > bin.len() {
                            break;
                        }
                        let x = f32::from_le_bytes([bin[p], bin[p + 1], bin[p + 2], bin[p + 3]]);
                        let y =
                            f32::from_le_bytes([bin[p + 4], bin[p + 5], bin[p + 6], bin[p + 7]]);
                        let z =
                            f32::from_le_bytes([bin[p + 8], bin[p + 9], bin[p + 10], bin[p + 11]]);
                        pos.push(g4mg::Vec3 { x, y, z });
                    }
                    pos
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            };

            if positions.is_empty() {
                global_prim_idx += 1;
                continue; // ignore les primitives sans position
            }

            // Normales (VEC3 float32).
            let normals = if let Some(n_idx) = attrs["NORMAL"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(n_idx as usize) {
                    let stride = if stride_hint == 0 { 12 } else { stride_hint };
                    let mut nrm = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + 12 > bin.len() {
                            break;
                        }
                        let x = f32::from_le_bytes([bin[p], bin[p + 1], bin[p + 2], bin[p + 3]]);
                        let y =
                            f32::from_le_bytes([bin[p + 4], bin[p + 5], bin[p + 6], bin[p + 7]]);
                        let z =
                            f32::from_le_bytes([bin[p + 8], bin[p + 9], bin[p + 10], bin[p + 11]]);
                        nrm.push(g4mg::Vec3 { x, y, z });
                    }
                    nrm
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            };

            // UV0 (VEC2 float32).
            let uv0 = if let Some(uv_idx) = attrs["TEXCOORD_0"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(uv_idx as usize) {
                    let stride = if stride_hint == 0 { 8 } else { stride_hint };
                    let mut uvs = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + 8 > bin.len() {
                            break;
                        }
                        let u = f32::from_le_bytes([bin[p], bin[p + 1], bin[p + 2], bin[p + 3]]);
                        let v =
                            f32::from_le_bytes([bin[p + 4], bin[p + 5], bin[p + 6], bin[p + 7]]);
                        uvs.push(g4mg::Vec2 { u, v });
                    }
                    uvs
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            };

            // COLOR_0 (VEC4 ou VEC3, float/ubyte/ushort).
            let colors = if let Some(col_idx) = attrs["COLOR_0"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(col_idx as usize) {
                    let acc = &accessors[col_idx as usize];
                    let attr_type = acc["type"].as_str().unwrap_or("VEC4");
                    let comp_type = acc["componentType"].as_u64().unwrap_or(5126);
                    let is_vec3 = attr_type == "VEC3";
                    let num_components = if is_vec3 { 3 } else { 4 };
                    let component_size = match comp_type {
                        5126 => 4, // float
                        5121 => 1, // unsigned byte
                        5123 => 2, // unsigned short
                        _ => 4,
                    };
                    let stride = if stride_hint == 0 {
                        num_components * component_size
                    } else {
                        stride_hint
                    };
                    let mut cols = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + num_components * component_size > bin.len() {
                            break;
                        }
                        let read_component = |offset_idx: usize| -> f32 {
                            let cop = p + offset_idx * component_size;
                            match comp_type {
                                5126 => f32::from_le_bytes([
                                    bin[cop],
                                    bin[cop + 1],
                                    bin[cop + 2],
                                    bin[cop + 3],
                                ]),
                                5121 => bin[cop] as f32 / 255.0,
                                5123 => {
                                    u16::from_le_bytes([bin[cop], bin[cop + 1]]) as f32 / 65535.0
                                }
                                _ => 1.0,
                            }
                        };
                        let r = read_component(0);
                        let g = read_component(1);
                        let b = read_component(2);
                        let a = if is_vec3 { 1.0 } else { read_component(3) };
                        cols.push(g4mg::Vec4 {
                            x: r,
                            y: g,
                            z: b,
                            w: a,
                        });
                    }
                    cols
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            };

            // Indices.
            let indices = if let Some(idx_acc) = prim["indices"].as_u64() {
                let acc = &accessors[idx_acc as usize];
                let bv_idx = acc["bufferView"].as_u64().unwrap_or(0) as usize;
                let bv = &buffer_views[bv_idx];
                let bv_offset = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
                let acc_offset = acc["byteOffset"].as_u64().unwrap_or(0) as usize;
                let off = bv_offset + acc_offset;
                let count = acc["count"].as_u64().unwrap_or(0) as usize;
                let component_type = acc["componentType"].as_u64().unwrap_or(5123);
                let idx_size = if component_type == 5125 { 4usize } else { 2 }; // 5125=uint32, 5123=uint16
                let mut idx = Vec::with_capacity(count);
                for i in 0..count {
                    let p = off + i * idx_size;
                    let v = if idx_size == 4 {
                        if p + 4 > bin.len() {
                            break;
                        }
                        u32::from_le_bytes([bin[p], bin[p + 1], bin[p + 2], bin[p + 3]])
                    } else {
                        if p + 2 > bin.len() {
                            break;
                        }
                        u32::from(u16::from_le_bytes([bin[p], bin[p + 1]]))
                    };
                    idx.push(v);
                }
                idx
            } else {
                Vec::new()
            };

            out.push(MeshPrimitive {
                component,
                source_index: global_prim_idx,
                material_index: mat_idx,
                material_name: mat_name,
                texture_uri: String::new(), // résolu par resolve_texture_uris()
                positions,
                normals,
                uv0,
                colors,
                indices,
                skin: None,
                piece: String::new(),
            });

            global_prim_idx += 1;
        }
    }

    Ok(out)
}

/// Extrait des primitives depuis une paire G4MD/G4MG (uniforme depuis CPK).
///
/// Utilisé quand le GLB de l'uniforme n'est pas pré-converti. Les données brutes G4MD+G4MG
/// sont parsées via [`g4md::parse`] et [`g4mg::extract_geometry`].
fn extract_primitives_from_g4md_g4mg(
    g4md_data: &[u8],
    g4mg_data: &[u8],
    component: MeshComponent,
) -> Result<Vec<MeshPrimitive>, AssembleError> {
    Ok(extract_piece(g4md_data, g4mg_data, component, "", None)?.0)
}

/// Bilan d'extraction d'une pièce : ce que le rapport d'assemblage publie par pièce.
#[derive(Debug, Clone, Default)]
pub struct PieceExtraction {
    /// Nom de la pièce.
    pub piece: String,
    /// Noms de matériaux du G4MD, dans l'ordre des slots.
    pub materials: Vec<String>,
    /// Noms de mailles du G4MD (vide si le fichier n'a pas de table de noms).
    pub mesh_names: Vec<String>,
    /// Vrai si la table de matériaux réelle (+0x43) a servi ; faux si les heuristiques
    /// historiques (positionnelle / par groupe) ont dû trancher.
    pub material_slots_from_file: bool,
    /// Sous-mailles lues (avant réduction des niveaux de détail).
    pub submeshes_read: usize,
    /// Sous-mailles écartées parce que leur nom porte `_LOD`.
    pub lod_dropped_by_name: usize,
    /// Primitives conservées (après rejet des aberrantes et des niveaux de détail grossiers).
    pub primitives_kept: usize,
    /// Bilan du skinning.
    pub skin: SkinDiagnostic,
}

/// Extrait les primitives d'une pièce G4MD/G4MG, avec son skinning si un squelette est fourni.
///
/// Le matériau de chaque sous-maille vient de la table réelle du G4MD (`material_slot`, +0x43)
/// quand elle est plausible ; sinon des heuristiques historiques (positionnelle pour l'éditeur,
/// par groupe pour les uniformes multi-LOD) qui ont été validées visuellement sur `u000101`.
pub fn extract_piece(
    g4md_data: &[u8],
    g4mg_data: &[u8],
    component: MeshComponent,
    piece: &str,
    skeleton: Option<&Skeleton>,
) -> Result<(Vec<MeshPrimitive>, PieceExtraction), AssembleError> {
    let md = g4md::parse(g4md_data)?;
    let mut submeshes = g4mg::extract_geometry(g4mg_data, &md);
    // Quand le fichier nomme ses mailles (`u011001_20`, `u011001_20_LOD1`, …), les niveaux de
    // détail grossiers sont écartés par leur nom — c'est ce que fait l'add-on Blender. Le filtre
    // géométrique par emprise reste appliqué ensuite pour les fichiers sans table de noms.
    let noms_connus = md.mesh_names.len() == md.submeshes.len() && !md.mesh_names.is_empty();
    let mut lod_ecartes = 0usize;
    if noms_connus {
        submeshes.retain(|sg| {
            let garde = md.lod_level_at(sg.index).is_none();
            if !garde {
                lod_ecartes += 1;
            }
            garde
        });
    }
    let slots_reels = md.material_slots_plausible();
    let mut diag = SkinDiagnostic::default();

    let nb_materiaux = md.material_base_names.len();
    let nb_sous_mailles = submeshes.len();
    let tous_a_zero = submeshes.iter().all(|sg| sg.material_index == 0);

    // Les modèles de `20_EDIT` déclarent `material_index = 0` sur TOUTES leurs sous-mailles alors
    // qu'ils portent plusieurs matériaux : `face51_nose01` a 3 sous-mailles, 3 matériaux, et trois
    // fois `mat=0`. Le lien est alors POSITIONNEL — la n-ième sous-maille prend le n-ième
    // matériau, ce que confirment les noms (`base_eye_10` sur la maille du visage à 1501 sommets,
    // `parts_eye_10` sur celle des yeux à 438, `parts_mouth_10` sur la bouche à 214).
    let positionnel = nb_materiaux == nb_sous_mailles && tous_a_zero && nb_materiaux > 1;

    // Un uniforme pousse le même défaut plus loin : `u000101` a huit sous-mailles, deux matériaux,
    // et là encore `mat=0` partout. Les huit se rangent en deux moitiés que la géométrie sépare
    // sans ambiguïté — quatre pour le haut du corps (dont ses trois niveaux de détail, boîte
    // `y ∈ [0,895 ; 1,264]`) et quatre pour le bas (`y ∈ [0,088 ; 0,895]`) — soit exactement un
    // groupe par matériau. On attribue donc le matériau par groupe de rangs égaux.
    //
    // Que ce découpage soit le bon se vérifie sur l'écran du jeu : il donne un maillot crème et un
    // short turquoise, les deux couleurs que portent les deux planches du conteneur
    // (`u000101_20` moyenne 242,240,238 et `u000101_30` moyenne 165,226,236). Sans lui, tout le
    // corps échantillonnait la planche turquoise.
    let taille_groupe = (!positionnel
        && tous_a_zero
        && nb_materiaux > 1
        && nb_sous_mailles > nb_materiaux
        && nb_sous_mailles.is_multiple_of(nb_materiaux))
    .then(|| nb_sous_mailles / nb_materiaux);

    let submeshes_read = submeshes.len() + lod_ecartes;
    let out: Vec<MeshPrimitive> = submeshes
        .into_iter()
        .enumerate()
        .map(|(rang, sg)| {
            let groupe = taille_groupe.map(|t| rang / t);
            let slot_reel = md
                .submeshes
                .get(sg.index)
                .filter(|_| slots_reels)
                .map(|sm| sm.material_slot);
            let (material_index, mat_name) = if let Some(slot) = slot_reel {
                (
                    slot,
                    md.material_base_names
                        .get(slot as usize)
                        .cloned()
                        .unwrap_or_default(),
                )
            } else if positionnel {
                (
                    u8::try_from(rang).unwrap_or(sg.material_index),
                    md.material_base_names
                        .get(rang)
                        .cloned()
                        .unwrap_or_default(),
                )
            } else if let Some(g) = groupe {
                (
                    u8::try_from(g).unwrap_or(sg.material_index),
                    md.material_base_names.get(g).cloned().unwrap_or_default(),
                )
            } else {
                (
                    sg.material_index,
                    g4mg::material_base_name(&md, &sg)
                        .cloned()
                        .unwrap_or_default(),
                )
            };
            let skin = match skeleton {
                Some(sk) => {
                    let s = resolve_submesh_skin(g4mg_data, &md, sg.index, sk, &mut diag);
                    if s.is_none() {
                        diag.static_submeshes += 1;
                    }
                    s
                }
                None => None,
            };
            MeshPrimitive {
                component,
                source_index: sg.index,
                material_index,
                material_name: mat_name,
                texture_uri: String::new(), // résolu par resolve_texture_uris()
                positions: sg.positions,
                normals: sg.normals,
                uv0: sg.uv0,
                colors: sg.colors,
                indices: sg.indices,
                skin,
                piece: piece.to_string(),
            }
        })
        .collect();

    let kept = retenir_niveau_detail_max(ecarter_positions_aberrantes(out));
    let extraction = PieceExtraction {
        piece: piece.to_string(),
        materials: md.material_base_names.clone(),
        mesh_names: md.mesh_names.clone(),
        material_slots_from_file: slots_reels,
        submeshes_read,
        lod_dropped_by_name: lod_ecartes,
        primitives_kept: kept.len(),
        skin: diag,
    };
    Ok((kept, extraction))
}

/// Écarte les primitives dont les positions ne sont pas finies ou sont hors de toute échelle.
///
/// `_base/base_normal_00` déclare une maille de bouche de 48 triangles dont les positions valent
/// ±3,4 × 10³⁸ — la valeur de `FLT_MAX`, c'est-à-dire un tampon jamais rempli. La rendre étire le
/// modèle jusqu'à l'infini et fait disparaître tout le reste à l'écran.
///
/// **Le seuil n'est pas une échelle d'avatar.** Il valait 100 — « un avatar tient dans deux
/// mètres » — et cette phrase ne parle que de `data/common/chr`. Les maps, les effets, les objets
/// de menu et les objets d'événement sont écrits en **unités de jeu**, pas en mètres : un dôme de
/// ciel (`map/sky/sky101c001`) mesure ±1 667, et le filtre le vidait entièrement. Les onze modèles
/// de la famille `map_sky` sortaient en glTF de 348 octets — zéro maille, aucune erreur.
///
/// Recensement du VFS complet (2026-09-20, `examples/census_position_limit`, 15 876 `.g4mg`),
/// sous-mailles par décade du plus grand `|coordonnée|` :
///
/// ```text
/// sous-arbre           <1e2     <1e3     <1e4     <1e5     <1e6    >=1e6/∞
/// common/chr          29654       13        0        0        0        25
/// common/effect       90210      486       43        8        0         5
/// common/event           44        6        0        0        0         0
/// common/map          18394    11643      565       12        0        19
/// common/menu          8131      114       61        0        0         0
/// ```
///
/// La décade `[1e5, 1e6)` est **vide sur tout le corpus** : la géométrie réelle s'arrête sous
/// 1e5 et le tampon non rempli commence à 3,4e38. Le seuil se pose donc dans ce vide, mesuré,
/// plutôt que sur une intuition d'échelle. À 100, 12 938 sous-mailles légitimes étaient écartées —
/// 40 % de celles des maps — pour 49 réellement aberrantes.
#[must_use]
pub fn ecarter_positions_aberrantes(prims: Vec<MeshPrimitive>) -> Vec<MeshPrimitive> {
    const LIMITE: f32 = 1e5;
    prims
        .into_iter()
        .filter(|p| {
            p.positions.iter().all(|v| {
                [v.x, v.y, v.z]
                    .iter()
                    .all(|c| c.is_finite() && c.abs() < LIMITE)
            })
        })
        .collect()
}

/// Fabrique les deux quads d'yeux, posés dans l'espace 3D du visage.
///
/// ⚠️ **Reconstitution assumée.** Aucun fichier ne porte le tracé des yeux — vingt variantes de
/// `_facetex/01_eye` mesurées à 0,000 % d'encre — et les masques ne peuvent pas le produire : leurs
/// zones couvrent 4,8 % et 15,6 % de la surface là où le visage du jeu n'en montre que 1,530 %.
/// À la demande de l'auteur du projet, les yeux sont donc **produits ici**.
///
/// Ils sont posés en **géométrie**, et non peints dans une texture : le dépliage du visage n'est
/// pas un plan frontal, et trois méthodes de calage — à l'œil, par les UV des sommets, par grille
/// témoin — ont toutes échoué, la dernière parce que l'éclairage de la scène fausse la lecture des
/// couleurs rendues. La position 3D, elle, se lit sans ambiguïté sur la maille `parts_eye_10`
/// (`x ± 0,116`, `y ∈ [1,362 ; 1,579]`, `z ∈ [0,029 ; 0,122]`).
///
/// Chaque quad porte l'intégralité de la texture d'œil en UV `0..1`, ce qui rend le placement
/// indépendant de tout dépliage.
#[must_use]
pub fn quads_yeux(echelle: f32) -> Vec<MeshPrimitive> {
    // Demi-largeur, demi-hauteur, écart au plan sagittal, hauteur et avancée — en mètres, sur le
    // modèle à l'échelle 1.
    const DEMI_L: f32 = 0.038;
    const DEMI_H: f32 = 0.027;
    const ECART: f32 = 0.052;
    const HAUTEUR: f32 = 1.4380;
    const AVANCEE: f32 = 0.1080;

    let mut out = Vec::with_capacity(2);
    for cote in [-1.0_f32, 1.0] {
        let cx = cote * ECART * echelle;
        let (dl, dh) = (DEMI_L * echelle, DEMI_H * echelle);
        let (y, z) = (HAUTEUR * echelle, AVANCEE * echelle);
        // Le quad est légèrement incliné : son bord extérieur recule, pour épouser la joue.
        let recul = 0.012 * echelle;
        let positions = vec![
            g4mg::Vec3 {
                x: cx - dl,
                y: y + dh,
                z: z - recul * cote.max(0.0),
            },
            g4mg::Vec3 {
                x: cx + dl,
                y: y + dh,
                z: z - recul * (-cote).max(0.0),
            },
            g4mg::Vec3 {
                x: cx + dl,
                y: y - dh,
                z: z - recul * (-cote).max(0.0),
            },
            g4mg::Vec3 {
                x: cx - dl,
                y: y - dh,
                z: z - recul * cote.max(0.0),
            },
        ];
        let normals = vec![
            g4mg::Vec3 {
                x: 0.0,
                y: 0.0,
                z: 1.0
            };
            4
        ];
        // Le côté droit est le miroir du gauche : on retourne son U.
        let (u0, u1) = if cote < 0.0 { (0.0, 1.0) } else { (1.0, 0.0) };
        let uv0 = vec![
            g4mg::Vec2 { u: u0, v: 0.0 },
            g4mg::Vec2 { u: u1, v: 0.0 },
            g4mg::Vec2 { u: u1, v: 1.0 },
            g4mg::Vec2 { u: u0, v: 1.0 },
        ];
        out.push(MeshPrimitive {
            component: MeshComponent::Generic,
            source_index: 0,
            material_index: 0,
            material_name: "avatar_eye".to_string(),
            texture_uri: String::new(),
            positions,
            normals,
            uv0,
            colors: Vec::new(),
            indices: vec![0, 2, 1, 0, 3, 2],
            skin: None,
            piece: String::new(),
        });
    }
    out
}

/// Fabrique les deux mains, posées au bout des manches.
///
/// ⚠️ **Reconstitution assumée.** La pièce `_uniform/g000201` existe bien, mais sa géométrie est
/// livrée en pose de liaison et attend le skinning : `examples/skin_probe` établit que ses indices
/// d'os vont de 0 à 37 pour 158 os déclarés — ils sont donc locaux à une palette, laquelle n'est ni
/// dans le G4MD ni contiguë dans le fichier. Sans elle, la maille atterrit hors du corps.
///
/// À la demande de l'auteur du projet, les mains sont donc **produites ici**, en géométrie simple,
/// à la position mesurée du bout de manche : `x = ± 0,326`, `y ∈ [1,134 ; 1,264]`,
/// `z ∈ [−0,066 ; 0,061]`. Elles prolongent le bras vers l'extérieur, comme en pose de repos.
#[must_use]
pub fn boites_mains(echelle: f32) -> Vec<MeshPrimitive> {
    // Bout de manche mesuré, puis dimensions de la main : longueur le long du bras, largeur et
    // épaisseur reprises de l'emprise de la manche.
    const MANCHE_X: f32 = 0.326;
    const CENTRE_Y: f32 = 1.199;
    const CENTRE_Z: f32 = -0.002;
    const LONGUEUR: f32 = 0.095;
    const DEMI_Y: f32 = 0.038;
    const DEMI_Z: f32 = 0.026;

    let mut out = Vec::with_capacity(2);
    for cote in [-1.0_f32, 1.0] {
        let x0 = cote * MANCHE_X * echelle;
        let x1 = cote * (MANCHE_X + LONGUEUR) * echelle;
        let (y, z) = (CENTRE_Y * echelle, CENTRE_Z * echelle);
        let (dy, dz) = (DEMI_Y * echelle, DEMI_Z * echelle);
        // Huit coins ; l'extrémité est légèrement rétrécie pour arrondir la silhouette.
        let r = 0.72;
        let coins: [[f32; 3]; 8] = [
            [x0, y - dy, z - dz],
            [x0, y + dy, z - dz],
            [x0, y + dy, z + dz],
            [x0, y - dy, z + dz],
            [x1, y - dy * r, z - dz * r],
            [x1, y + dy * r, z - dz * r],
            [x1, y + dy * r, z + dz * r],
            [x1, y - dy * r, z + dz * r],
        ];
        let positions: Vec<g4mg::Vec3> = coins
            .iter()
            .map(|c| g4mg::Vec3 {
                x: c[0],
                y: c[1],
                z: c[2],
            })
            .collect();
        // Normales approchées : la direction du coin vers le centre de la main.
        let (cx, cy, cz) = ((x0 + x1) / 2.0, y, z);
        let normals: Vec<g4mg::Vec3> = coins
            .iter()
            .map(|c| {
                let (nx, ny, nz) = (c[0] - cx, c[1] - cy, c[2] - cz);
                let n = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-6);
                g4mg::Vec3 {
                    x: nx / n,
                    y: ny / n,
                    z: nz / n,
                }
            })
            .collect();
        let uv0 = vec![g4mg::Vec2 { u: 0.5, v: 0.5 }; 8];
        // Douze triangles : les six faces de la boîte.
        let indices = vec![
            0, 1, 2, 0, 2, 3, // extrémité côté bras
            4, 6, 5, 4, 7, 6, // extrémité libre
            0, 4, 5, 0, 5, 1, // dessous
            3, 2, 6, 3, 6, 7, // dessus
            0, 3, 7, 0, 7, 4, // avant
            1, 5, 6, 1, 6, 2, // arrière
        ];
        out.push(MeshPrimitive {
            component: MeshComponent::Generic,
            source_index: 0,
            material_index: 0,
            material_name: "avatar_hand".to_string(),
            texture_uri: String::new(),
            positions,
            normals,
            uv0,
            colors: Vec::new(),
            indices,
            skin: None,
            piece: String::new(),
        });
    }
    out
}

/// Déforme la tête selon la forme de visage choisie.
///
/// ⚠️ **Reconstitution assumée.** Les six parts de la catégorie « Forme de visage » ont toutes
/// `resource = 0xFFFFFFFF` dans le catalogue : elles ne désignent **aucune ressource**, ni maille
/// ni texture. Le choix ne pouvait donc rien changer au modèle — ce n'était pas un défaut de la
/// page mais une donnée absente.
///
/// À la demande de l'auteur du projet, chaque forme applique ici une mise à l'échelle non uniforme
/// de la tête : `(largeur, longueur)`, autour du centre du crâne. Les six couples vont du visage
/// large et court au visage étroit et allongé, ce que les six vignettes du jeu suggèrent.
///
/// Seule la tête bouge : la déformation ne s'applique qu'au-dessus de `SEUIL_COU`, la base du cou
/// mesurée sur la maille du visage.
pub fn deformer_visage(prims: &mut [MeshPrimitive], forme: usize, echelle: f32) {
    /// Base du cou : la maille du visage commence à `y = 1,293`.
    const SEUIL_COU: f32 = 1.290;
    /// Centre du crâne, autour duquel la tête est mise à l'échelle.
    const CENTRE_Y: f32 = 1.44;
    const FORMES: [(f32, f32); 6] = [
        (1.00, 1.00), // 01 — ovale, la référence
        (1.07, 0.95), // 02 — large et court
        (0.94, 1.06), // 03 — étroit et allongé
        (1.04, 1.02), // 04 — plein
        (0.97, 0.97), // 05 — menu
        (1.10, 1.00), // 06 — carré
    ];
    let (kx, ky) = FORMES[forme.min(FORMES.len() - 1)];
    if (kx - 1.0).abs() < f32::EPSILON && (ky - 1.0).abs() < f32::EPSILON {
        return;
    }
    let (seuil, centre) = (SEUIL_COU * echelle, CENTRE_Y * echelle);
    for prim in prims {
        for p in &mut prim.positions {
            if p.y < seuil {
                continue;
            }
            // Le fondu évite une cassure nette à la base du cou.
            let t = ((p.y - seuil) / (0.06 * echelle)).clamp(0.0, 1.0);
            p.x *= 1.0 + (kx - 1.0) * t;
            p.z *= 1.0 + (kx - 1.0) * t;
            p.y = centre + (p.y - centre) * (1.0 + (ky - 1.0) * t);
        }
    }
}

/// Écart au plan sagittal où commence le bras, hauteur de l'articulation, et angle de descente.
///
/// **Mesurés sur la maille du haut du corps**, en la découpant en tranches de `|x|` : sous 0,20 les
/// sommets descendent jusqu'à `y = 0,895` — c'est le torse ; au-delà ils forment une bande étroite,
/// `y ∈ [1,134 ; 1,264]` — c'est le bras. Le seuil de 0,20 sépare donc les deux, et il écarte du
/// même coup la tête (cheveux à ± 0,157), le short (± 0,186) et les chaussures (± 0,152).
pub const BRAS_EPAULE_X: f32 = 0.200;
/// Hauteur de l'articulation de l'épaule. Cf. [`BRAS_EPAULE_X`].
pub const BRAS_EPAULE_Y: f32 = 1.200;
/// Angle dont le bras descend depuis l'horizontale, en radians. Cf. [`BRAS_EPAULE_X`].
pub const BRAS_ANGLE: f32 = 1.05;

/// Descend les bras le long du corps, depuis la pose de liaison.
///
/// ⚠️ **Reconstitution assumée.** La géométrie du jeu est stockée en **pose de liaison** — bras à
/// l'horizontale — et c'est le moteur qui la met en pose par skinning à l'exécution. Cette chaîne
/// d'export ne le porte pas : la palette qui relierait les indices d'os de la maille au squelette
/// n'est ni dans le G4MD ni contiguë dans le fichier (`examples/skin_probe` : indices 0..37 pour
/// 158 os déclarés).
///
/// La rotation ne s'applique qu'au-delà de [`BRAS_EPAULE_X`], seuil **mesuré** qui isole le bras du
/// torse et écarte tout le reste du modèle. Deux essais antérieurs, bornés trop grossièrement,
/// avaient emporté l'un les jambes, l'autre la tête ; c'est cette mesure qui manquait.
///
/// Les mains suivent sans traitement particulier : elles sont au-delà du seuil.
pub fn poser_bras(prims: &mut [MeshPrimitive], echelle: f32) {
    let (ex, ey) = (BRAS_EPAULE_X * echelle, BRAS_EPAULE_Y * echelle);
    for prim in prims {
        for p in &mut prim.positions {
            let cote = if p.x >= 0.0 { 1.0_f32 } else { -1.0 };
            let dx = (p.x - cote * ex) * cote; // distance à l'épaule, le long du bras
            if dx <= 0.0 {
                continue;
            }
            // Fondu sur 2 cm : l'épaule reste ronde au lieu de casser net.
            let t = (dx / (0.020 * echelle)).clamp(0.0, 1.0);
            let (sa, ca) = (-cote * BRAS_ANGLE * t).sin_cos();
            let (vx, vy) = (p.x - cote * ex, p.y - ey);
            p.x = cote * ex + vx * ca - vy * sa;
            p.y = ey + vx * sa + vy * ca;
        }
    }
}

/// Ajuste la coupe du maillot : col, manches et ourlet.
///
/// ⚠️ **Reconstitution assumée.** Les trois catégories de l'onglet « Habits » — 19 col, 20 manches,
/// 21 ourlet — n'ont dans le catalogue **aucune maille ni texture** : leurs parts ne portent qu'un
/// nom, `fashion_default`, `fashion_collar`, `fashion_shoulder_baring`, `fashion_shirt_out`,
/// `fashion_navel_baring`. Le choix ne pouvait donc rien changer au modèle.
///
/// Ces noms décrivent des découpes, et c'est ce qu'on applique ici, sur la maille du haut du corps
/// dont l'emprise est mesurée : `x = ± 0,326`, `y ∈ [0,895 ; 1,264]`, le bas du maillot à 0,895 et
/// le bout de manche à 0,326.
///
/// - **manches** : `shoulder_baring` rétracte la manche vers l'épaule ;
/// - **ourlet** : `shirt_out` descend le bas du maillot, `navel_baring` le remonte ;
/// - **col** : `collar` dégage légèrement l'encolure en abaissant le haut du maillot.
pub fn ajuster_maillot(
    prims: &mut [MeshPrimitive],
    col: usize,
    manches: usize,
    ourlet: usize,
    echelle: f32,
) {
    /// Bas du maillot, mesuré sur la maille du haut du corps.
    const BAS: f32 = 0.895;
    /// Épaule : au-delà, on est dans la manche.
    const EPAULE: f32 = 0.200;

    let facteur_manche = match manches {
        1 => 0.55, // épaules dénudées : la manche se rétracte
        _ => 1.0,
    };
    let decalage_ourlet = match ourlet {
        1 => -0.060, // chemise sortie : le bas descend
        2 => 0.070,  // nombril découvert : le bas remonte
        _ => 0.0,
    } * echelle;
    let decalage_col = match col {
        1 => -0.022, // col dégagé
        _ => 0.0,
    } * echelle;

    if facteur_manche == 1.0 && decalage_ourlet == 0.0 && decalage_col == 0.0 {
        return;
    }
    let (bas, epaule) = (BAS * echelle, EPAULE * echelle);
    let haut = 1.264 * echelle;
    for prim in prims {
        // Seule la maille du maillot est concernée ; les mains et la tête n'ont rien à y voir.
        if prim.material_name != "u000101_30_LOD1" {
            continue;
        }
        for p in &mut prim.positions {
            // Manche : on ramène le sommet vers l'épaule.
            let dx = p.x.abs() - epaule;
            if dx > 0.0 && facteur_manche != 1.0 {
                p.x = p.x.signum() * (epaule + dx * facteur_manche);
            }
            // Ourlet : les sommets du bas suivent, avec un fondu vers le milieu du torse.
            let t_bas = 1.0 - ((p.y - bas) / (0.14 * echelle)).clamp(0.0, 1.0);
            p.y += decalage_ourlet * t_bas;
            // Col : les sommets du haut, près de l'axe, s'abaissent.
            if p.x.abs() < epaule {
                let t_haut = ((p.y - (haut - 0.06 * echelle)) / (0.06 * echelle)).clamp(0.0, 1.0);
                p.y += decalage_col * t_haut;
            }
        }
    }
}

/// Boîte englobante d'une primitive, ou `None` si elle n'a aucun sommet.
fn boite_englobante(prim: &MeshPrimitive) -> Option<([f32; 3], [f32; 3])> {
    let mut it = prim.positions.iter();
    let p0 = it.next()?;
    let (mut mn, mut mx) = ([p0.x, p0.y, p0.z], [p0.x, p0.y, p0.z]);
    for p in it {
        for (k, v) in [p.x, p.y, p.z].into_iter().enumerate() {
            mn[k] = mn[k].min(v);
            mx[k] = mx[k].max(v);
        }
    }
    Some((mn, mx))
}

/// Dit si deux boîtes coïncident à 2 % près de leur diagonale.
///
/// La tolérance est relative : deux niveaux de détail de la même pièce ne donnent pas des bornes
/// strictement égales, parce que le maillage grossier coupe des sommets extrêmes. Sur le corps de
/// `u000101` l'écart mesuré plafonne à 2 mm pour une pièce de 65 cm, soit 0,3 %.
fn boites_coincident(a: ([f32; 3], [f32; 3]), b: ([f32; 3], [f32; 3])) -> bool {
    let diag = (0..3)
        .map(|k| a.1[k] - a.0[k])
        .fold(0.0_f32, f32::max)
        .max(1e-4);
    let tol = diag * 0.02;
    (0..3).all(|k| (a.0[k] - b.0[k]).abs() <= tol && (a.1[k] - b.1[k]).abs() <= tol)
}

/// Ne retient, parmi des sous-mailles empilées, que le niveau de détail le plus fin.
///
/// Un modèle d'uniforme range ses niveaux de détail comme des sous-mailles ordinaires, sans
/// aucun champ qui les distingue : `u000101` en déclare huit, et le G4MD leur donne à toutes
/// `material_index = 0`. Les rendre toutes empile trois copies de chaque pièce à la même place —
/// elles s'interpénètrent, et la couleur affichée devient celle que le tampon de profondeur
/// laisse gagner. C'est ce qui donnait un maillot turquoise barré de blanc là où le jeu montre un
/// maillot blanc à col turquoise.
///
/// Ce que les fichiers permettent d'affirmer, c'est que les niveaux d'une même pièce sont
/// **consécutifs**, qu'ils partagent la **même boîte englobante** et que leur nombre de triangles
/// **décroît** : le haut du corps donne 778, 404 puis 298 triangles pour la boîte
/// `y ∈ [0,895 ; 1,264]`, le bas 802, 400 et 314, les chaussures 868, 390 et 274. On regroupe donc
/// les primitives consécutives de même boîte et on garde celle qui porte le plus de triangles.
///
/// Les pièces réellement distinctes ne sont pas touchées : le visage a trois sous-mailles de
/// boîtes différentes (le visage, les yeux, la bouche), et elles sont toutes conservées.
#[must_use]
pub fn retenir_niveau_detail_max(prims: Vec<MeshPrimitive>) -> Vec<MeshPrimitive> {
    let mut sortie: Vec<MeshPrimitive> = Vec::with_capacity(prims.len());
    for prim in prims {
        let empile = match (sortie.last(), boite_englobante(&prim)) {
            (Some(prec), Some(b)) => {
                boite_englobante(prec).is_some_and(|a| boites_coincident(a, b))
            }
            _ => false,
        };
        if !empile {
            sortie.push(prim);
            continue;
        }
        // Même emprise que la précédente : c'est un autre niveau de la même pièce. On garde le
        // plus fin des deux, et l'ordre d'origine ne compte pas — seul le compte de triangles.
        let remplacer = sortie
            .last()
            .is_some_and(|prec| prim.triangle_count() > prec.triangle_count());
        if remplacer {
            sortie.pop();
            sortie.push(prim);
        }
    }
    sortie
}

// ── API publique principale ───────────────────────────────────────────────────

/// Entrées nécessaires pour assembler le modèle d'un personnage.
///
/// Toutes les informations de matching sont pré-résolues par l'appelant depuis les tables
/// gamedata (`chara_base`, `chara_model`, `uniform_config`, `inagle_teams`, `inagle_uniforms`).
pub struct CharacterAssemblyInput {
    /// Code interne du personnage (ex. `"c01000010"`).
    pub internal_code: String,
    /// Indice de type corporel (0..17, 101, 201), issu de `CHARA_BODY_INFO.var[4]`.
    pub body_type_idx: u8,
    /// Répertoire contenant les GLB pré-convertis (`dx11/model/`).
    pub glb_dir: PathBuf,
    /// CRC du modèle uniforme sélectionné (`0` = pas d'uniforme / non résolu).
    pub uniform_model_crc: u32,
    /// Données G4MD brutes de l'uniforme (issues du CPK), si disponibles.
    pub uniform_g4md: Option<Vec<u8>>,
    /// Données G4MG brutes de l'uniforme (issues du CPK), si disponibles.
    pub uniform_g4mg: Option<Vec<u8>>,
    /// GLB pré-converti de l'uniforme (chemin complet), si disponible.
    pub uniform_glb_path: Option<PathBuf>,
    /// Pièces modulaires complémentaires de la tenue (chaussures, peau/cou/bras, gants,
    /// brassard et plaque de nom), résolues depuis `chara_parts` par l'appelant.
    ///
    /// Elles partagent le même espace monde et le même rôle de rendu que l'uniforme principal.
    /// L'ordre est conservé afin que l'appelant puisse reproduire exactement la recette du jeu.
    pub uniform_parts: Vec<CharacterUniformPart>,
    /// Tête de base brute (`_face/20_EDIT/_base/<base>.g4md` + `.g4mg`) lue dans le VFS. Quand
    /// elle est fournie, elle remplace le GLB pré-converti et porte son skinning.
    pub body_raw: Option<RawPiece>,
    /// Visage brut (`CHARA_MODEL_INFO.var[10]` → `.g4md` + `.g4mg`). Idem : prime sur le GLB.
    pub face_raw: Option<RawPiece>,
    /// Squelette du corps (`CHARA_BODY_INFO` → objbin → `<stem>/<stem>.g4sk`). Sans lui, toutes
    /// les pièces restent statiques et le rapport le dit.
    pub skeleton: Option<Skeleton>,
}

/// Une paire G4MD/G4MG brute lue dans le VFS, avec sa provenance.
pub struct RawPiece {
    /// Nom court de la pièce (`c01001900`, `base_normal_00`, `sk000101`…).
    pub name: String,
    /// Chemin VFS du G4MD (traçabilité du rapport).
    pub g4md_path: String,
    /// Données G4MD brutes.
    pub g4md: Vec<u8>,
    /// Données G4MG brutes.
    pub g4mg: Vec<u8>,
}

/// Une pièce G4MD+G4MG complémentaire d'un uniforme de personnage.
pub struct CharacterUniformPart {
    /// Rôle dans la recette (`uniform`, `nameplate`, `skin`, `armband`, `shoes`, `gloves`).
    pub role: String,
    /// Pièce brute et sa provenance.
    pub raw: RawPiece,
}

/// Redescend uniquement une face dont toute la géométrie commence trop haut.
///
/// Le minimum vertical ne peut pas servir à un recalage symétrique : les cheveux longs d'Aphrody
/// descendent naturellement sous la tête de base. Les remonter détruit un modèle déjà aligné. Les
/// défauts observés dans le corpus sont dans l'autre sens (face flottante, minimum trop haut), donc
/// cette correction reste volontairement unidirectionnelle.
fn recaler_face_flotante(body: &[MeshPrimitive], face: &mut [MeshPrimitive]) {
    const SEUIL_RECALAGE_FACE: f32 = 0.05;

    let base_y = |prims: &[MeshPrimitive]| -> Option<f32> {
        prims
            .iter()
            .flat_map(|p| p.positions.iter())
            .map(|p| p.y)
            .fold(None::<f32>, |acc, y| Some(acc.map_or(y, |m| m.min(y))))
    };

    let (Some(base_corps), Some(base_face)) = (base_y(body), base_y(face)) else {
        return;
    };
    let dy = base_corps - base_face;
    if dy >= -SEUIL_RECALAGE_FACE {
        return;
    }

    let translation = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, dy, 0.0, 1.0],
    ];
    for prim in face {
        appliquer_matrice(prim, &translation);
    }
}

/// Assemble le modèle 3D complet d'un personnage IEVR.
///
/// Charge et combine les composants :
/// 1. **Corps** (tête de base) — `body_raw` (G4MD/G4MG du VFS, skinné) s'il est fourni, sinon
///    `glb_dir/base_<classe>_NN.glb` (statique).
/// 2. **Visage** — `face_raw` s'il est fourni, sinon `glb_dir/<internal_code>.glb`.
/// 3. **Uniforme** — les `uniform_parts` (haut, plaque, peau, brassard, chaussures, gants) avec
///    leur rôle ; à défaut, l'ancien couple `uniform_g4md`/`uniform_g4mg` ou `uniform_glb_path`.
///
/// Quand `skeleton` est fourni, chaque pièce brute est skinnée : les indices locaux de ses
/// palettes sont résolus par hachage de nom d'os contre ce squelette, et les os non trouvés
/// sont abandonnés (jamais réattribués). Le squelette n'est retenu dans le modèle que si au moins
/// une primitive est skinnée. Le `report` du modèle détaille chaque pièce.
///
/// Le recalage vertical du visage ne s'applique qu'à un visage issu d'un GLB pré-converti : un
/// visage brut est exprimé dans l'espace de bind du squelette, comme le corps.
///
/// # Erreurs
///
/// - [`AssembleError::NoBaseGlb`] si `body_type_idx` n'a pas de tête de base (101/201/inconnu).
/// - [`AssembleError::GlbNotFound`] si un fichier GLB de repli est manquant.
/// - [`AssembleError::Corrupt`] si un GLB est malformé.
/// - [`AssembleError::Format`] si les données G4MD/G4MG sont invalides.
pub fn assemble_character_model(
    input: &CharacterAssemblyInput,
) -> Result<AssembledModel, AssembleError> {
    use serde_json::json;

    let skeleton = input.skeleton.as_ref();
    let mut pieces_report: Vec<serde_json::Value> = Vec::new();

    // ── 1. Corps (tête de base) ──────────────────────────────────────────────
    let body_glb_name = type_idx_to_glb_name(input.body_type_idx)
        .ok_or(AssembleError::NoBaseGlb(input.body_type_idx))?;

    // La tête de base (`_face/20_EDIT/_base`) est celle de l'éditeur d'avatar : un visage brut de
    // personnage porte déjà sa tête. Elle n'est chargée que si l'appelant la fournit, ou, à
    // défaut de visage brut, depuis le GLB pré-converti (ancien pipeline, qui la superposait).
    let body_primitives = match (&input.body_raw, &input.face_raw) {
        (Some(raw), _) => {
            let (prims, ex) = extract_piece(
                &raw.g4md,
                &raw.g4mg,
                MeshComponent::Body,
                &raw.name,
                skeleton,
            )?;
            pieces_report.push(piece_report("body", &raw.g4md_path, &ex, &prims, skeleton));
            prims
        }
        (None, Some(_)) => Vec::new(),
        (None, None) => {
            let path = input.glb_dir.join(format!("{body_glb_name}.glb"));
            let prims = extract_primitives_from_glb(&read_glb(&path)?, MeshComponent::Body)?;
            pieces_report.push(glb_report("body", &path, &prims));
            prims
        }
    };

    // ── 2. Visage ─────────────────────────────────────────────────────────────
    let (face_primitives, face_from_glb) = match &input.face_raw {
        Some(raw) => {
            let (prims, ex) = extract_piece(
                &raw.g4md,
                &raw.g4mg,
                MeshComponent::Face,
                &raw.name,
                skeleton,
            )?;
            pieces_report.push(piece_report("face", &raw.g4md_path, &ex, &prims, skeleton));
            (prims, false)
        }
        None => {
            let path = input.glb_dir.join(format!("{}.glb", input.internal_code));
            let prims = extract_primitives_from_glb(&read_glb(&path)?, MeshComponent::Face)?;
            pieces_report.push(glb_report("face", &path, &prims));
            (prims, true)
        }
    };

    // ── 3. Uniforme ───────────────────────────────────────────────────────────
    let mut uniform_primitives = if let Some(glb_path) = &input.uniform_glb_path {
        // Voie A : GLB pré-converti (rare, 2 fichiers disponibles sur 384 uniformes)
        let prims = extract_primitives_from_glb(&read_glb(glb_path)?, MeshComponent::Uniform)?;
        pieces_report.push(glb_report("uniform", glb_path, &prims));
        prims
    } else if let (Some(g4md_data), Some(g4mg_data)) = (&input.uniform_g4md, &input.uniform_g4mg) {
        // Voie B : G4MD+G4MG bruts depuis CPK, sans provenance détaillée (ancien appelant).
        let (prims, ex) = extract_piece(
            g4md_data,
            g4mg_data,
            MeshComponent::Uniform,
            "uniform",
            skeleton,
        )?;
        pieces_report.push(piece_report("uniform", "", &ex, &prims, skeleton));
        prims
    } else {
        // Voie C : l'uniforme arrive par `uniform_parts`, ou n'est pas disponible.
        Vec::new()
    };
    for part in &input.uniform_parts {
        let (prims, ex) = extract_piece(
            &part.raw.g4md,
            &part.raw.g4mg,
            MeshComponent::Uniform,
            &part.raw.name,
            skeleton,
        )?;
        pieces_report.push(piece_report(
            &part.role,
            &part.raw.g4md_path,
            &ex,
            &prims,
            skeleton,
        ));
        uniform_primitives.extend(prims);
    }

    // ── 2 bis. Rejet des primitives aux positions aberrantes ─────────────────
    //
    // Certains GLB de face portent des coordonnées absurdes. Mesuré le 2026-08-31 sur
    // `c01000500` servi en production, maille de visage, 439 + 271 + 29 sommets :
    // **aucun `NaN`, aucun infini** — les valeurs sont finies, mais de l'ordre de 10³⁷ à 10³⁸
    // (y réel jusqu'à 3,34e38). Tester la finitude ne les attrape donc pas ; c'est la
    // plausibilité qu'il faut mesurer.
    //
    // Une telle boîte englobante est contagieuse : c'est celle du modèle entier, et tout cadrage
    // automatique sur elle (`model-viewer`, un rendu hors ligne) recule la caméra à l'infini —
    // le personnage se réduit à un point. Mieux vaut servir un modèle amputé de la maille fautive
    // qu'un modèle entier inregardable.
    //
    // La borne est large à dessein : un personnage tient dans deux mètres, une map dans quelques
    // centaines. Cent mètres ne rejette qu'une géométrie qui n'a de toute façon aucun sens sur un
    // visage.
    const LIMITE_PLAUSIBLE_M: f32 = 100.0;

    let mut face_primitives: Vec<MeshPrimitive> = face_primitives
        .into_iter()
        .filter(|prim| {
            prim.positions.iter().all(|p| {
                [p.x, p.y, p.z]
                    .iter()
                    .all(|c| c.is_finite() && c.abs() <= LIMITE_PLAUSIBLE_M)
            })
        })
        .collect();

    // ── 2 ter. Recalage de la face sur le corps (GLB pré-convertis seulement) ─
    //
    // Les GLB de face pré-convertis ne sont pas tous exprimés à la même hauteur : la translation
    // y est CUITE dans les sommets (aucun nœud ne porte de `translation`, aucun `skin`), et
    // certains modèles la portent fausse. Mesuré le 2026-08-31 sur les fichiers du VPS :
    //
    // | modèle | base de la face | écart |
    // |---|---|---|
    // | `c01004650` | 1,276 m | référence |
    // | `c03037170` | 1,521 m | +0,24 m |
    // | `c04001020` | 1,741 m | +0,46 m |
    //
    // Le corps, lui, est toujours au même endroit. Une face dont le minimum est trop haut doit être
    // redescendue. L'inverse n'est pas vrai : une coiffure longue peut descendre très bas tout en
    // étant correctement alignée, comme Aphrody (`c01001900`, minimum 0,894 m).
    //
    // Un visage brut du VFS est dans l'espace de bind du squelette : on ne le touche pas, une
    // translation calculée sur ses bornes le détacherait de ses os.
    let mut face_recalee = false;
    if face_from_glb {
        let avant = face_primitives
            .iter()
            .flat_map(|p| p.positions.iter().map(|v| v.y))
            .fold(f32::INFINITY, f32::min);
        recaler_face_flotante(&body_primitives, &mut face_primitives);
        let apres = face_primitives
            .iter()
            .flat_map(|p| p.positions.iter().map(|v| v.y))
            .fold(f32::INFINITY, f32::min);
        face_recalee = (avant - apres).abs() > 1e-6;
    }

    // ── Assemblage ────────────────────────────────────────────────────────────
    let mut all_primitives = Vec::with_capacity(
        body_primitives.len() + face_primitives.len() + uniform_primitives.len(),
    );
    all_primitives.extend(body_primitives);
    all_primitives.extend(face_primitives);
    all_primitives.extend(uniform_primitives);

    let skinned = all_primitives.iter().filter(|p| p.skin.is_some()).count();
    let skeleton_kept = if skinned > 0 {
        input.skeleton.clone()
    } else {
        None
    };
    let skeleton_report = match (&input.skeleton, &skeleton_kept) {
        (Some(sk), Some(_)) => json!({
            "source": sk.source,
            "bones": sk.bones.len(),
            "bind_consistency_error": sk.bind_consistency_error(),
            "roots": sk.bones.iter().filter(|b| b.parent.is_none()).map(|b| b.name.clone()).collect::<Vec<_>>(),
        }),
        (Some(sk), None) => json!({
            "source": sk.source,
            "bones": sk.bones.len(),
            "unused": "aucune primitive skinnée : le squelette n'est pas exporté",
        }),
        (None, _) => serde_json::Value::Null,
    };

    let report = json!({
        "code": input.internal_code,
        "body_type_idx": input.body_type_idx,
        "body_base": body_glb_name,
        "uniform_crc": format!("{:#010x}", input.uniform_model_crc),
        "mode": if skinned > 0 { "skinned" } else { "static" },
        "primitives": all_primitives.len(),
        "skinned_primitives": skinned,
        "face_from_glb": face_from_glb,
        "face_recalee": face_recalee,
        "skeleton": skeleton_report,
        "pieces": pieces_report,
    });

    Ok(AssembledModel {
        internal_code: input.internal_code.clone(),
        body_glb: body_glb_name.to_string(),
        face_glb: input.internal_code.clone(),
        uniform_crc: input.uniform_model_crc,
        primitives: all_primitives,
        embedded_textures: Vec::new(),
        skeleton: skeleton_kept,
        aux_textures: Vec::new(),
        report,
        strict_materials: true,
        animation_clips: Vec::new(),
        animation_excluded: Vec::new(),
    })
}

/// Bornes monde d'un ensemble de primitives (`None` s'il n'y a aucun sommet).
#[must_use]
pub fn bornes(prims: &[MeshPrimitive]) -> Option<([f32; 3], [f32; 3])> {
    let mut lo = [f32::INFINITY; 3];
    let mut hi = [f32::NEG_INFINITY; 3];
    let mut any = false;
    for p in prims.iter().flat_map(|p| p.positions.iter()) {
        any = true;
        for (k, v) in [p.x, p.y, p.z].into_iter().enumerate() {
            lo[k] = lo[k].min(v);
            hi[k] = hi[k].max(v);
        }
    }
    any.then_some((lo, hi))
}

/// Entrée de rapport pour une pièce brute.
fn piece_report(
    role: &str,
    source: &str,
    ex: &PieceExtraction,
    prims: &[MeshPrimitive],
    skeleton: Option<&Skeleton>,
) -> serde_json::Value {
    use serde_json::json;
    let bones_used: Vec<String> = ex
        .skin
        .bones_used
        .iter()
        .map(|&b| {
            skeleton
                .and_then(|s| s.bones.get(b as usize))
                .map_or_else(|| format!("#{b}"), |bone| bone.name.clone())
        })
        .collect();
    let (lo, hi) = bornes(prims).unwrap_or(([0.0; 3], [0.0; 3]));
    json!({
        "role": role,
        "piece": ex.piece,
        "source": source,
        "origin": "vfs",
        "materials": ex.materials,
        "mesh_names": ex.mesh_names,
        "material_slots_from_file": ex.material_slots_from_file,
        "submeshes_read": ex.submeshes_read,
        "lod_dropped_by_name": ex.lod_dropped_by_name,
        "primitives_kept": ex.primitives_kept,
        "vertices": prims.iter().map(MeshPrimitive::vertex_count).sum::<usize>(),
        "triangles": prims.iter().map(MeshPrimitive::triangle_count).sum::<usize>(),
        "bounds_min": lo,
        "bounds_max": hi,
        "primitive_materials": prims.iter().map(|p| p.material_name.clone()).collect::<Vec<_>>(),
        "skin": {
            "skinned_submeshes": ex.skin.skinned_submeshes,
            "static_submeshes": ex.skin.static_submeshes,
            "unresolved_hashes": ex.skin.unresolved_hashes.iter().map(|h| format!("{h:#010x}")).collect::<Vec<_>>(),
            "vertices_without_bone": ex.skin.vertices_without_bone,
            "bones_used": bones_used,
            "max_influences": prims.iter().filter_map(|p| p.skin.as_ref()).map(PrimitiveSkin::max_influences).max().unwrap_or(0),
        }
    })
}

/// Entrée de rapport pour un composant lu dans un GLB pré-converti (statique).
fn glb_report(role: &str, path: &Path, prims: &[MeshPrimitive]) -> serde_json::Value {
    use serde_json::json;
    let (lo, hi) = bornes(prims).unwrap_or(([0.0; 3], [0.0; 3]));
    json!({
        "role": role,
        "source": path.display().to_string(),
        "origin": "glb",
        "primitives_kept": prims.len(),
        "vertices": prims.iter().map(MeshPrimitive::vertex_count).sum::<usize>(),
        "triangles": prims.iter().map(MeshPrimitive::triangle_count).sum::<usize>(),
        "bounds_min": lo,
        "bounds_max": hi,
        "skin": { "skinned_submeshes": 0, "static_submeshes": prims.len() }
    })
}

/// Une pièce d'avatar à assembler : son rôle et ses données de maillage.
///
/// L'avatar de l'éditeur n'est pas un modèle unique mais un empilement : un corps par
/// morphologie, un visage, des coiffures avant et arrière, des oreilles, des accessoires. Chaque
/// pièce vit à plat sous `chr/_face/20_EDIT/<dossier>/<nom>.{g4md,g4mg}`.
pub struct AvatarPiece {
    /// Rôle de la pièce dans le modèle final.
    pub component: MeshComponent,
    /// Données G4MD brutes.
    pub g4md: Vec<u8>,
    /// Données G4MG brutes.
    pub g4mg: Vec<u8>,
    /// Matrice d'attache à appliquer aux sommets, si la pièce n'est pas déjà en espace monde.
    ///
    /// Les pièces de `20_EDIT` (visage, coiffure, oreilles) sont exprimées dans le repère de
    /// l'os qui les porte : leur boîte englobante est centrée sur l'origine (y ∈ [−0,07 ; 0,23]),
    /// pas à hauteur de tête. Les mailles d'uniforme, elles, sont déjà en espace monde
    /// (y ∈ [0 ; 1,30]). Empiler les deux sans transformation pose la tête sur les chaussures.
    /// Cette matrice est la pose de repos de l'os d'attache — cf. [`bone_rest_world`].
    pub attach: Option<[[f32; 4]; 4]>,
}

/// À quel matériau de la tête revient une famille de planches de visage.
///
/// Un modèle de tête déclare deux ou trois matériaux, et **chacun a sa propre planche** — il n'y
/// a pas de texture unique du visage. Mesuré sur `face51_nose01`, dont les trois sous-mailles ont
/// des dépliages disjoints : le visage (matériau 0, `base_eye_10`, 1501 sommets) couvre tout le
/// carré UV, les yeux (matériau 1, `parts_eye_10`, 438 sommets) n'occupent qu'un coin, la bouche
/// (matériau 2, `parts_mouth_10`, 214 sommets) la zone juste en dessous.
///
/// Les familles se répartissent donc par rôle, et non par dépliage : composer les cinq familles
/// de traits ensemble faisait écraser les yeux et les sourcils par la bouche, opaque sur toute sa
/// planche.
///
/// La répartition suit le **dépliage**, qui est ce qui se mesure :
///
/// | famille | dépliage | rang de matériau |
/// |---|---|---|
/// | `00_face`, `02_pupil`, `03_highlight` | 512×512, carré | 0 — la maille du visage, dont les UV couvrent tout le carré |
/// | `01_eye` | 2048×1024 | 1 — la maille des yeux |
/// | `04_eyebrow`, `05_mouth` | 2048×1024 | 2 — la maille de la bouche |
///
/// La pupille et les reflets partagent le dépliage carré de la peau, et non celui des yeux : ils
/// se composent donc SUR la peau, ce que confirme leur canal alpha — `pupil_L_00` est la seule
/// planche du visage à en porter un vrai, précisément pour se poser sur ce qu'il y a dessous.
///
/// **Ce rangement de la pupille est contredit par son contenu**, mesuré le 2026-09-01. Le masque
/// de `pupil_L_01` est un ovale **bleu plein qui occupe tout le carré** — 35,90 % de la surface,
/// 64,06 % de fond rouge, aucun vert — et non une pièce cadrée quelque part dans le dépliage du
/// visage. Composé sur le matériau 0, il pose un ovale au milieu de la figure : c'est exactement
/// ce que rend la texture produite aujourd'hui. Une planche pleine cadre vise un quad qui lui est
/// propre, pas le carré du visage.
///
/// Deux inconnues restent, et aucune ne se tranche par la taille de la texture, seul critère qui
/// avait servi ici : quel matériau reçoit `02_pupil`, et par quelle transformation d'UV. Tant
/// qu'elles tiennent, la composition laisse ces planches au chemin par défaut plutôt que de les
/// découper — cf. [`crate::planche::Convention::ZoneBleue`]. Le sourcil, lui, a été tranché : sa
/// planche est un atlas de huit variantes, au même dépliage que la bouche.
///
/// Le sourcil, longtemps absent du modèle, a été **résolu le 2026-09-01** — et le diagnostic qui
/// figurait ici était faux sur deux points, faute d'avoir mesuré autre chose qu'une planche.
///
/// Il était écrit que `04_eyebrow/eyebrow_00.g4tx` est un aplat rouge, donc que le tracé manque
/// dans la donnée. En réalité c'est son **masque** qui est rouge à 100 %, la planche de couleur
/// étant blanche ; et surtout `eyebrow_00` est la variante **« sans sourcil »** de sa famille.
/// Les 39 autres conteneurs portent bien leur tracé — dans le vert de leur masque, comme l'œil :
/// 1,57 à 5,46 % de la surface, emprise `v[0,120 ; 0,792]`. Relevé sur les 431 planches de
/// `_facetex` par `nie avatar planches` (cf. [`crate::planche`]) : 78 des 80 planches de
/// `04_eyebrow` rendent la convention `trace-vert`.
///
/// La cause était donc dans le compositeur, qui réservait cette convention à `01_eye` par un test
/// sur le nom de famille et teignait le sourcil comme une planche ordinaire — le peignant en
/// carnation opaque sur tout son rectangle. Mesuré sur la texture du matériau 2 : 33,61 % de
/// pixels visibles avant (huit pavés de peau), 11,89 % après (huit sourcils détourés plus les
/// bouches). Aucune des six familles n'a de convention unique : elle se mesure, planche par
/// planche.
///
/// Rend `None` si la famille n'est pas reconnue.
#[must_use]
pub fn face_layer_slot(famille: &str) -> Option<usize> {
    match famille.split('/').next().unwrap_or(famille) {
        "00_face" | "02_pupil" | "03_highlight" => Some(0),
        "01_eye" => Some(1),
        "04_eyebrow" | "05_mouth" => Some(2),
        _ => None,
    }
}

/// Le corps habillé qui va avec un squelette d'édition, et les chaussures assorties.
///
/// L'éditeur d'avatar ne montre pas un modèle unique : il montre un corps habillé de la tenue
/// `u117401_10` / `s117401_10` — la seule que portent les 32 recettes
/// `common/chr/_test/default/mdl_edit_avatar*.cfg.bin` — surmonté d'une tête attachée à l'os
/// `c_head_1_0`. Encore faut-il que le corps et le squelette soient de la même taille.
///
/// **Cet appariement est mesuré, pas supposé.** Pour chacune des 32 combinaisons (8 corps
/// `u000101`…`u000108` × 4 squelettes `c000X01_edit`), on compare le haut du corps au bas de la
/// tête une fois celle-ci attachée. Le résultat sépare nettement : un bon appariement laisse un
/// écart de 4 à 33 mm, un mauvais d'au moins 194 mm. D'où :
///
/// | squelette | corps | écart mesuré |
/// |---|---|---|
/// | `c000101_edit` | `u000101`, `u000102` | 11 mm, 10 mm |
/// | `c000201_edit` | `u000103`, `u000104` | 16 mm, 19 mm |
/// | `c000301_edit` | `u000105`, `u000108` | 33 mm, 13 mm |
/// | `c000401_edit` | `u000106`, `u000107` | 28 mm, 4 mm |
///
/// Chaque squelette a **deux** corps, vraisemblablement masculin et féminin — leurs hauteurs sont
/// trop proches pour que la mesure les départage, et aucune source lue ne le dit. Le premier de
/// la paire est donc rendu en tête, et le second reste accessible : c'est un ordre, pas un
/// relevé de genre. Cf. le test `chaque_corps_epouse_son_squelette`.
///
/// Rend une liste vide si le squelette est inconnu.
#[must_use]
pub fn avatar_bodies_for_skeleton(skeleton: &str) -> &'static [&'static str] {
    match skeleton {
        "c000101_edit" => &["u000101", "u000102"],
        "c000201_edit" => &["u000103", "u000104"],
        "c000301_edit" => &["u000105", "u000108"],
        "c000401_edit" => &["u000106", "u000107"],
        _ => &[],
    }
}

/// Le corps qui va avec une morphologie de l'éditeur, par son nom.
///
/// Les huit morphologies du catalogue (`modelesDeBase.morphologies`) se répartissent les huit
/// corps `u000101`…`u000108`. L'affectation n'est pas devinée : elle découle de **deux contraintes
/// indépendantes qui se recoupent**.
///
/// 1. **Le squelette**, apparié par la jointure cou/tête ([`avatar_bodies_for_skeleton`]) : il
///    réduit chaque morphologie à deux corps possibles.
/// 2. **La corpulence mesurée**, qui départage la paire et concorde avec le nom :
///
/// | morphologie | corps | taille | épaules | tour de taille | rapport |
/// |---|---|---:|---:|---:|---:|
/// | `male` | `u000101` | 1,304 | 0,653 | 0,328 | 1,99 |
/// | `female` | `u000102` | 1,303 | 0,615 | 0,354 | 1,73 |
/// | `small` | `u000103` | 0,960 | 0,496 | 0,311 | 1,59 |
/// | `smallfat` | `u000104` | 0,963 | 0,507 | 0,389 | 1,30 |
/// | `tall` | `u000105` | 1,545 | 0,774 | 0,385 | 2,01 |
/// | `tallmuscle` | `u000108` | 1,565 | 0,774 | 0,370 | 2,09 |
/// | `muscle` | `u000106` | 1,804 | 1,367 | 0,649 | 2,11 |
/// | `big` | `u000107` | 1,772 | 1,413 | 0,994 | 1,42 |
///
/// Chaque ligne se lit : `female` a les épaules plus étroites et le tour de taille plus large que
/// `male`, d'où un rapport nettement plus bas ; `smallfat` est plus large que `small` à taille
/// égale ; `big` a un tour de taille de 0,99 m quand `muscle`, aussi grand, garde 0,65 ;
/// `tallmuscle` a le rapport le plus élevé de sa paire. **Aucune affectation ne repose sur l'ordre
/// des fichiers** — il ne suit d'ailleurs pas les morphologies, `u000108` venant avant `u000106`.
///
/// Rend `None` pour un nom inconnu.
#[must_use]
pub fn avatar_body_for_morphology(morphologie: &str) -> Option<&'static str> {
    Some(match morphologie {
        "male" => "u000101",
        "female" => "u000102",
        "small" => "u000103",
        "smallfat" => "u000104",
        "tall" => "u000105",
        "tallmuscle" => "u000108",
        "muscle" => "u000106",
        "big" => "u000107",
        _ => return None,
    })
}

/// Le modèle de **mains** de la tenue de l'éditeur — **non monté**, et voici pourquoi.
///
/// Les mains existent bien (`_uniform/g000001`, `g000201`, `g000301`, `g000401`) et se situent à
/// la bonne hauteur, y ∈ [1,156 ; 1,230] m. Mais leur maille est **skinnée sur 158 os** et livrée
/// en pose de bind, bras en croix : son envergure atteint **1,552 m** (x ∈ [−0,776 ; +0,776])
/// quand le corps habillé n'en fait que 0,652. Montées telles quelles, elles flottent à 45 cm des
/// manches — et, la boîte englobante triplant, elles ruinent le cadrage automatique du
/// visualiseur.
///
/// Les quatre familles ont exactement la même envergure : ce n'est donc pas un problème de choix.
/// Il manque, entre la manche courte du maillot (±0,326) et la main (±0,776), l'**avant-bras**,
/// qui est de la peau. Or la peau du personnage (`common/chr/c000101`) a ses slots de maille
/// **vides** dans son objbin, comme `_bodySK` : le moteur les pose à l'exécution.
///
/// Les monter correctement demande donc d'appliquer le **skinning** avec la pose de repos, ce que
/// `aphrody-nie-render3d` sait faire mais que cette chaîne d'export ne porte pas. En attendant, mieux vaut
/// un avatar sans mains qu'un avatar aux mains flottantes.
pub const AVATAR_HANDS: &str = "g000201";

/// Le dossier de modèle qui héberge les mains de l'éditeur. Cf. [`AVATAR_HANDS`].
pub const AVATAR_HANDS_DIR: &str = "g000201";

/// Le modèle de chaussures de la tenue de l'éditeur.
///
/// Contrairement au corps, il n'a pas à s'apparier au squelette : les quatre variantes
/// `s000201`…`s000204` posent toutes au sol (y = 0).
pub const AVATAR_SHOES: &str = "s000201";

/// Le dossier de modèle qui héberge les corps de l'éditeur.
///
/// Les huit variantes vivent toutes dans `u000101/`, quel que soit leur numéro : le dossier porte
/// le nom de la FAMILLE, pas celui de la variante.
pub const AVATAR_BODY_DIR: &str = "u000101";

/// Le dossier de modèle qui héberge les chaussures de l'éditeur.
pub const AVATAR_SHOES_DIR: &str = "s000201";

/// Pose de repos, en espace monde, de l'os nommé d'un squelette G4SK.
///
/// Sert à replacer une pièce exprimée dans le repère de son os d'attache. Pour l'éditeur
/// d'avatar, l'os est `c_head_1_0` du squelette `_bodySK/<code>_edit.g4sk` : c'est lui qui porte
/// le visage, la coiffure et les oreilles.
///
/// Rend `None` si le squelette est illisible ou si l'os n'existe pas.
#[must_use]
pub fn bone_rest_world(g4sk: &[u8], bone_name: &str) -> Option<[[f32; 4]; 4]> {
    let header = crate::g4sk::parse_header(g4sk).ok()?;
    let hierarchie = crate::g4sk::parse_hierarchy(g4sk, &header);
    let idx = hierarchie.bones.iter().position(|b| b.name == bone_name)?;
    let poses = crate::g4sk::parse_poses(g4sk, &header)?;
    let parents: Vec<i16> = hierarchie.bones.iter().map(|b| b.parent_index).collect();
    crate::g4sk::rest_world_matrices(&poses, &parents)
        .get(idx)
        .copied()
}

/// Applique une matrice 4×4 (col-major) aux positions et aux normales d'une primitive.
///
/// Les normales ne reçoivent que la partie rotation : leur appliquer la translation les
/// enverrait toutes dans la même direction.
fn appliquer_matrice(prim: &mut MeshPrimitive, m: &[[f32; 4]; 4]) {
    for p in &mut prim.positions {
        let (x, y, z) = (p.x, p.y, p.z);
        p.x = m[0][0] * x + m[1][0] * y + m[2][0] * z + m[3][0];
        p.y = m[0][1] * x + m[1][1] * y + m[2][1] * z + m[3][1];
        p.z = m[0][2] * x + m[1][2] * y + m[2][2] * z + m[3][2];
    }
    for n in &mut prim.normals {
        let (x, y, z) = (n.x, n.y, n.z);
        let (nx, ny, nz) = (
            m[0][0] * x + m[1][0] * y + m[2][0] * z,
            m[0][1] * x + m[1][1] * y + m[2][1] * z,
            m[0][2] * x + m[1][2] * y + m[2][2] * z,
        );
        let l = (nx * nx + ny * ny + nz * nz).sqrt();
        if l > 1e-6 {
            n.x = nx / l;
            n.y = ny / l;
            n.z = nz / l;
        }
    }
}

/// Assemble un avatar de l'éditeur depuis ses pièces, dans l'ordre donné.
///
/// Contrairement à [`assemble_character_model`], rien n'est résolu depuis les tables gamedata :
/// l'appelant fournit les pièces déjà lues, parce que leur choix vient de l'éditeur (recette,
/// morphologie) et non d'une fiche de personnage.
///
/// # Erreurs
///
/// [`AssembleError::Format`] si un couple G4MD/G4MG est invalide. Une pièce sans primitive est
/// ignorée : un accessoire vide ne doit pas faire échouer l'avatar entier.
pub fn assemble_avatar_model(
    code: &str,
    pieces: &[AvatarPiece],
) -> Result<AssembledModel, AssembleError> {
    let mut primitives = Vec::new();
    for piece in pieces {
        let mut extraites =
            extract_primitives_from_g4md_g4mg(&piece.g4md, &piece.g4mg, piece.component)?;
        if let Some(m) = piece.attach.as_ref() {
            for prim in &mut extraites {
                appliquer_matrice(prim, m);
            }
        }
        primitives.extend(extraites);
    }
    Ok(AssembledModel {
        internal_code: code.to_string(),
        body_glb: String::new(),
        face_glb: String::new(),
        uniform_crc: 0,
        primitives,
        embedded_textures: Vec::new(),
        skeleton: None,
        aux_textures: Vec::new(),
        report: serde_json::Value::Null,
        strict_materials: false,
        animation_clips: Vec::new(),
        animation_excluded: Vec::new(),
    })
}

// ── Modèles génériques (keshin / armures) ─────────────────────────────────────

/// Paramètres pour l'assemblage d'un modèle générique (keshin, armure, objet…).
pub struct GenericModelInput {
    /// Identifiant du modèle (ex. `"k000010"`, `"ka001901"`).
    pub code: String,
    /// Données G4MD brutes.
    pub g4md: Vec<u8>,
    /// Données G4MG brutes.
    pub g4mg: Vec<u8>,
    /// Composant glTF à attribuer aux primitives.
    pub component: MeshComponent,
}

/// Assemble un modèle générique depuis des données G4MD+G4MG brutes.
///
/// Utilisé pour les **keshin** (`common/chr/_keshin/`), les **armures** (`common/chr/_armd/`),
/// et tout autre modèle G4MD+G4MG non lié à un personnage. La paire G4MD+G4MG est typiquement
/// extraite d'un CPK via le VFS ou le manifeste CRC→chemin (`var/model-crc-manifest.ndjson`).
///
/// Les primitives produites ont `material_name` résolu depuis le G4MD (noms base-color). Les
/// `texture_uri` sont vides ; appeler [`AssembledModel::resolve_texture_uris`] si nécessaire.
///
/// # Erreurs
///
/// - [`AssembleError::Format`] si le G4MD ou G4MG est invalide.
pub fn assemble_generic_model(input: GenericModelInput) -> Result<AssembledModel, AssembleError> {
    let primitives = extract_primitives_from_g4md_g4mg(&input.g4md, &input.g4mg, input.component)?;
    Ok(AssembledModel {
        internal_code: input.code,
        body_glb: String::new(),
        face_glb: String::new(),
        uniform_crc: 0,
        primitives,
        embedded_textures: Vec::new(),
        skeleton: None,
        aux_textures: Vec::new(),
        report: serde_json::Value::Null,
        strict_materials: false,
        animation_clips: Vec::new(),
        animation_excluded: Vec::new(),
    })
}

/// Choisit le G4MD qui décrit réellement un G4MG donné, entre celui **embarqué** dans le
/// `.g4pkm` voisin et un `.g4md` **libre**.
///
/// ## La règle, et pourquoi elle n'est pas symétrique
///
/// Le G4MD embarqué gagne dès qu'il existe. Un G4MD libre voisin peut décrire un **autre LOD** :
/// ses offsets et ses strides sortent alors du G4MG compagnon, et l'assemblage rend une maille
/// tronquée ou vide plutôt qu'une erreur (mesuré sur `d010020` et `k000100`). Le fichier libre
/// n'est donc qu'un repli, jamais un choix par défaut.
///
/// ## Ce que cette règle débloque
///
/// La famille `common/chr/_waza/` — les modèles de cut-in de technique — ne porte **aucun**
/// `.g4md` libre : mesuré le 2026-09-19, 0 sur ses 12 343 fichiers. Son descripteur vit
/// exclusivement dans le `.g4pkm`. Sans cette précédence, ces modèles sont inassemblables ; avec
/// elle, `ev60_00340` (« God Knows ») rend ses 3 420 sommets et 5 388 triangles de matériau
/// `wing_10`.
///
/// ## Les **maps** inversent cette précédence — ne pas leur appliquer cette fonction
///
/// `aphrody-nie-model-serve` lit d'abord le `.g4md` libre pour une map, et ne retombe sur le paquet que
/// s'il manque. La règle ci-dessous vaut pour les **modèles de personnage et de technique**, pas
/// pour la géométrie de terrain ; les aplatir en une seule règle changerait silencieusement ce
/// qu'une map assemble.
///
/// Rend `None` si aucune des deux sources ne porte de G4MD exploitable.
#[must_use]
pub fn g4md_canonical<'a>(
    g4pkm: Option<&'a [u8]>,
    standalone: Option<&'a [u8]>,
) -> Option<&'a [u8]> {
    g4pkm.and_then(crate::g4pkm::extract_g4md).or(standalone)
}

/// Raccourci : assemble un **keshin** depuis ses données G4MD+G4MG brutes.
///
/// `code` est l'identifiant du keshin (ex. `"k000010"`), typiquement le nom de répertoire
/// dans `common/chr/_keshin/`.
///
/// # Erreurs
///
/// Identiques à [`assemble_generic_model`].
pub fn assemble_keshin(
    code: &str,
    g4md: Vec<u8>,
    g4mg: Vec<u8>,
) -> Result<AssembledModel, AssembleError> {
    assemble_generic_model(GenericModelInput {
        code: code.to_string(),
        g4md,
        g4mg,
        component: MeshComponent::Keshin,
    })
}

/// Raccourci : assemble une **armure** (armed) depuis ses données G4MD+G4MG brutes.
///
/// `code` est l'identifiant de l'armure (ex. `"ka001901"`), typiquement le nom de répertoire
/// dans `common/chr/_armd/`.
///
/// # Erreurs
///
/// Identiques à [`assemble_generic_model`].
pub fn assemble_armed(
    code: &str,
    g4md: Vec<u8>,
    g4mg: Vec<u8>,
) -> Result<AssembledModel, AssembleError> {
    assemble_generic_model(GenericModelInput {
        code: code.to_string(),
        g4md,
        g4mg,
        component: MeshComponent::Armed,
    })
}

// ── Chargement depuis manifeste CRC→chemin + VFS ─────────────────────────────

/// Entrée du manifeste CRC→chemin (parsée depuis `var/model-crc-manifest.ndjson`).
///
/// Chaque ligne du manifeste a la forme :
/// `{"crc":1234567890,"path":"data/common/chr/_uniform/u011001/u011001.g4md","cpk":"abc.cpk"}`
#[derive(Debug, Clone)]
pub struct ManifestEntry {
    /// CRC32 nie (accumulateur brut, sans finalisation).
    pub crc: u32,
    /// Chemin interne du fichier dans les CPK (relatif à `data/`).
    pub path: String,
    /// Nom du CPK contenant le fichier.
    pub cpk: String,
}

/// Charge le manifeste CRC→chemin depuis un lecteur NDJSON.
///
/// Chaque ligne valide est parsée en [`ManifestEntry`]. Les lignes malformées sont silencieusement
/// ignorées (tolère les lignes partielles en fin de fichier). Retourne toutes les entrées valides.
#[must_use]
pub fn load_manifest(ndjson: &str) -> Vec<ManifestEntry> {
    ndjson
        .lines()
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
            let crc = v["crc"].as_u64()? as u32;
            let path = v["path"].as_str()?.to_string();
            let cpk = v["cpk"].as_str()?.to_string();
            Some(ManifestEntry { crc, path, cpk })
        })
        .collect()
}

/// Résout le chemin G4MD dans le manifeste depuis un CRC32.
///
/// Cherche l'entrée avec `crc == target_crc` ET dont l'extension est `.g4md`. Retourne
/// le chemin interne (ex. `"data/common/chr/_uniform/u011001/u011001.g4md"`) ou `None`.
#[must_use]
pub fn resolve_crc_to_g4md_path(manifest: &[ManifestEntry], target_crc: u32) -> Option<&str> {
    manifest
        .iter()
        .find(|e| e.crc == target_crc && e.path.ends_with(".g4md"))
        .map(|e| e.path.as_str())
}

/// Construit le chemin G4MG compagnon depuis un chemin G4MD (remplace l'extension).
///
/// Ex. `"data/common/chr/_uniform/u011001/u011001.g4md"` → `"data/common/chr/_uniform/u011001/u011001.g4mg"`.
#[must_use]
pub fn g4md_to_g4mg_path(g4md_path: &str) -> String {
    if let Some(stem) = g4md_path.strip_suffix(".g4md") {
        alloc::format!("{stem}.g4mg")
    } else {
        g4md_path.to_string()
    }
}

// ── Export glTF binaire (GLB 2.0) ────────────────────────────────────────────

/// Construit le JSON glTF + buffer binaire à partir du modèle assemblé.
///
/// `with_textures = true` : émet des `images[]` + `textures[]` + matériaux PBR avec
/// `baseColorTexture` pour chaque primitive dont `texture_uri` est renseigné.
/// `with_textures = false` : un seul matériau générique `Default`.
///
/// Structure du GLB émis :
/// ```text
/// header (12 B) + chunk JSON + chunk BIN
/// ```
fn build_glb(model: &AssembledModel, with_textures: bool) -> Vec<u8> {
    use serde_json::{Value, json};

    // Buffer binaire accumulant toutes les données d'accessors (positions, normales, UV, indices).
    let mut bv_data: Vec<u8> = Vec::new();
    let mut accessor_defs: Vec<Value> = Vec::new();
    let mut buffer_views_json: Vec<Value> = Vec::new();

    /// Ajoute un bufferView + accessor et renvoie l'index accessor.
    #[allow(clippy::too_many_arguments)]
    fn add_accessor(
        bv_data: &mut Vec<u8>,
        buffer_views_json: &mut Vec<Value>,
        accessor_defs: &mut Vec<Value>,
        raw: &[u8],
        count: usize,
        comp_type: u32,
        attr_type: &str,
        min_val: Option<Value>,
        max_val: Option<Value>,
    ) -> usize {
        let bv_offset = bv_data.len();
        bv_data.extend_from_slice(raw);
        // alignement 4B (glTF spec)
        while !bv_data.len().is_multiple_of(4) {
            bv_data.push(0);
        }

        let bv_idx = buffer_views_json.len();
        buffer_views_json.push(json!({
            "buffer": 0,
            "byteOffset": bv_offset,
            "byteLength": raw.len()
        }));

        let acc_idx = accessor_defs.len();
        let mut acc = json!({
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": comp_type,
            "count": count,
            "type": attr_type
        });
        if let Some(mn) = min_val {
            acc["min"] = mn;
        }
        if let Some(mx) = max_val {
            acc["max"] = mx;
        }
        accessor_defs.push(acc);
        acc_idx
    }

    // ── Collecte des URI de textures uniques (pour la table images/textures) ──
    // Chaque URI unique → un index de texture glTF.
    // Les primitives sans texture_uri (vide) → matériau Default (index 0).
    let mut uri_to_tex_idx: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut image_defs: Vec<Value> = Vec::new();
    let mut texture_defs: Vec<Value> = Vec::new();

    if with_textures {
        for prim in &model.primitives {
            if prim.texture_uri.is_empty() {
                continue;
            }
            if uri_to_tex_idx.contains_key(&prim.texture_uri) {
                continue;
            }
            let img_idx = image_defs.len();
            image_defs.push(json!({
                "uri": prim.texture_uri,
                "mimeType": "image/png"
            }));
            let tex_idx = texture_defs.len();
            texture_defs.push(json!({ "source": img_idx }));
            uri_to_tex_idx.insert(prim.texture_uri.clone(), tex_idx);
        }
    }

    // ── Matériaux ─────────────────────────────────────────────────────────────
    // - Index 0 : matériau générique Default (blanc, PBR sans texture).
    // - Index 1+ : matériaux avec baseColorTexture (un par URI unique), si with_textures.
    let mut material_defs: Vec<Value> = Vec::new();
    material_defs.push(json!({
        "name": "Default",
        "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": 0.0,
            "roughnessFactor": 1.0
        }
    }));
    // Map URI → material index (pour les primitives texturées).
    let mut uri_to_mat_idx: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    if with_textures {
        for (uri, tex_idx) in &uri_to_tex_idx {
            let mat_idx = material_defs.len();
            material_defs.push(json!({
                "name": uri,
                "pbrMetallicRoughness": {
                    "baseColorTexture": { "index": tex_idx },
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0
                },
                "doubleSided": true
            }));
            uri_to_mat_idx.insert(uri.clone(), mat_idx);
        }
    }

    // ── Parcours des composants ───────────────────────────────────────────────
    let components_order = [
        MeshComponent::Body,
        MeshComponent::Face,
        MeshComponent::Uniform,
        MeshComponent::Keshin,
        MeshComponent::Armed,
        MeshComponent::Generic,
    ];
    let mut mesh_nodes: Vec<Value> = Vec::new();
    let mut mesh_defs: Vec<Value> = Vec::new();

    for comp in components_order {
        let comp_prims: Vec<&MeshPrimitive> = model
            .primitives
            .iter()
            .filter(|p| p.component == comp)
            .collect();

        if comp_prims.is_empty() {
            continue;
        }

        let comp_name = match comp {
            MeshComponent::Body => "Body",
            MeshComponent::Face => "Face",
            MeshComponent::Uniform => "Uniform",
            MeshComponent::Keshin => "Keshin",
            MeshComponent::Armed => "Armed",
            MeshComponent::Generic => "Generic",
        };

        let mut prim_defs: Vec<Value> = Vec::new();

        for prim in &comp_prims {
            if prim.positions.is_empty() {
                continue;
            }

            // Positions → VEC3 float32 (5126).
            let pos_raw: Vec<u8> = prim
                .positions
                .iter()
                .flat_map(|v| [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes()].concat())
                .collect();
            let p_min: Vec<f32> = vec![
                prim.positions
                    .iter()
                    .map(|v| v.x)
                    .fold(f32::INFINITY, f32::min),
                prim.positions
                    .iter()
                    .map(|v| v.y)
                    .fold(f32::INFINITY, f32::min),
                prim.positions
                    .iter()
                    .map(|v| v.z)
                    .fold(f32::INFINITY, f32::min),
            ];
            let p_max: Vec<f32> = vec![
                prim.positions
                    .iter()
                    .map(|v| v.x)
                    .fold(f32::NEG_INFINITY, f32::max),
                prim.positions
                    .iter()
                    .map(|v| v.y)
                    .fold(f32::NEG_INFINITY, f32::max),
                prim.positions
                    .iter()
                    .map(|v| v.z)
                    .fold(f32::NEG_INFINITY, f32::max),
            ];
            let pos_acc = add_accessor(
                &mut bv_data,
                &mut buffer_views_json,
                &mut accessor_defs,
                &pos_raw,
                prim.positions.len(),
                5126,
                "VEC3",
                Some(json!(p_min)),
                Some(json!(p_max)),
            );

            // Normales → VEC3 float32 (5126), optionnel.
            let normal_acc = if !prim.normals.is_empty() {
                let raw: Vec<u8> = prim
                    .normals
                    .iter()
                    .flat_map(|v| {
                        [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes()].concat()
                    })
                    .collect();
                Some(add_accessor(
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                    &raw,
                    prim.normals.len(),
                    5126,
                    "VEC3",
                    None,
                    None,
                ))
            } else {
                None
            };

            // UV0 → VEC2 float32 (5126), optionnel.
            let uv_acc = if !prim.uv0.is_empty() {
                let raw: Vec<u8> = prim
                    .uv0
                    .iter()
                    .flat_map(|v| {
                        let mut b = [0u8; 8];
                        b[..4].copy_from_slice(&v.u.to_le_bytes());
                        b[4..].copy_from_slice(&v.v.to_le_bytes());
                        b
                    })
                    .collect();
                Some(add_accessor(
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                    &raw,
                    prim.uv0.len(),
                    5126,
                    "VEC2",
                    None,
                    None,
                ))
            } else {
                None
            };

            // Colors → VEC4 float32 (5126), optionnel.
            let _color_acc = if !prim.colors.is_empty() {
                let raw: Vec<u8> = prim
                    .colors
                    .iter()
                    .flat_map(|v| {
                        [
                            v.x.to_le_bytes(),
                            v.y.to_le_bytes(),
                            v.z.to_le_bytes(),
                            v.w.to_le_bytes(),
                        ]
                        .concat()
                    })
                    .collect();
                Some(add_accessor(
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                    &raw,
                    prim.colors.len(),
                    5126,
                    "VEC4",
                    None,
                    None,
                ))
            } else {
                None
            };

            // Indices → SCALAR uint16 ou uint32.
            let use_u32 = prim.positions.len() > 65535;
            let (idx_comp_type, idx_raw): (u32, Vec<u8>) = if use_u32 {
                (
                    5125,
                    prim.indices.iter().flat_map(|&i| i.to_le_bytes()).collect(),
                )
            } else {
                (
                    5123,
                    prim.indices
                        .iter()
                        .flat_map(|&i| (i as u16).to_le_bytes())
                        .collect(),
                )
            };
            // Alignement 4B
            let mut idx_raw_padded = idx_raw;
            while idx_raw_padded.len() % 4 != 0 {
                idx_raw_padded.push(0);
            }
            let idx_acc = add_accessor(
                &mut bv_data,
                &mut buffer_views_json,
                &mut accessor_defs,
                &idx_raw_padded,
                prim.indices.len(),
                idx_comp_type,
                "SCALAR",
                None,
                None,
            );

            // Résolution du matériau : texture si disponible, sinon Default (0).
            let mat_idx = if with_textures && !prim.texture_uri.is_empty() {
                *uri_to_mat_idx.get(&prim.texture_uri).unwrap_or(&0)
            } else {
                0usize
            };

            // Construction du prim JSON.
            let mut attrs_obj = json!({ "POSITION": pos_acc });
            if let Some(n) = normal_acc {
                attrs_obj["NORMAL"] = json!(n);
            }
            if let Some(u) = uv_acc {
                attrs_obj["TEXCOORD_0"] = json!(u);
            }
            if model.skeleton.is_some() {
                glb_emit_skin_attributes(
                    prim,
                    &mut attrs_obj,
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                );
            }
            // Desactive COLOR_0 pour eviter que les shaders standards n'appliquent des couleurs de debug/masquage
            // if let Some(c) = color_acc { attrs_obj["COLOR_0"] = json!(c); }

            prim_defs.push(json!({
                "attributes": attrs_obj,
                "indices": idx_acc,
                "material": mat_idx,
                "mode": 4  // TRIANGLES
            }));
        }

        if prim_defs.is_empty() {
            continue;
        }

        let mesh_idx = mesh_defs.len();
        mesh_defs.push(json!({
            "name": comp_name,
            "primitives": prim_defs
        }));
        mesh_nodes.push(json!({
            "name": comp_name,
            "mesh": mesh_idx
        }));
    }

    let (node_indices, skins_json, bone_node_base) = glb_attach_skeleton(
        model,
        &mut mesh_defs,
        &mut mesh_nodes,
        &mut bv_data,
        &mut buffer_views_json,
        &mut accessor_defs,
    );
    let (animations_json, animation_extras) = glb_emit_animations(
        model,
        bone_node_base,
        &mut bv_data,
        &mut buffer_views_json,
        &mut accessor_defs,
    );

    // ── JSON glTF complet ─────────────────────────────────────────────────────
    let mut gltf_obj = json!({
        "asset": {
            "version": "2.0",
            "generator": "aphrody-nie-formats assemble.rs"
        },
        "accessors": accessor_defs,
        "bufferViews": buffer_views_json,
        "buffers": [{ "byteLength": bv_data.len() }],
        "materials": material_defs,
        "meshes": mesh_defs,
        "nodes": mesh_nodes,
        "scene": 0,
        "scenes": [{ "nodes": node_indices }]
    });
    if let Some(skins) = skins_json {
        gltf_obj["skins"] = skins;
    }
    if let Some(animations) = animations_json {
        gltf_obj["animations"] = animations;
    }
    if let Some(extras) = animation_extras {
        gltf_obj["extras"] = json!({ "nie": { "animation": extras } });
    }

    // Injecte images et textures uniquement si with_textures et qu'on en a.
    if with_textures && !image_defs.is_empty() {
        gltf_obj["images"] = json!(image_defs);
        gltf_obj["textures"] = json!(texture_defs);
    }

    let json_bytes = gltf_obj.to_string().into_bytes();
    // Padding JSON à 4B avec espaces (glTF spec).
    let json_padded_len = (json_bytes.len() + 3) & !3;
    let mut json_padded = json_bytes;
    while json_padded.len() < json_padded_len {
        json_padded.push(0x20);
    }

    // Padding BIN à 4B avec zéros.
    let bin_padded_len = (bv_data.len() + 3) & !3;
    let mut bin_padded = bv_data;
    while bin_padded.len() < bin_padded_len {
        bin_padded.push(0);
    }

    let total_len = 12 + 8 + json_padded_len + 8 + bin_padded_len;

    let mut glb: Vec<u8> = Vec::with_capacity(total_len);

    // Header GLB.
    glb.extend_from_slice(&0x46546C67u32.to_le_bytes()); // magic "glTF"
    glb.extend_from_slice(&2u32.to_le_bytes()); // version 2
    glb.extend_from_slice(&(total_len as u32).to_le_bytes());

    // Chunk JSON.
    glb.extend_from_slice(&(json_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes()); // "JSON"
    glb.extend_from_slice(&json_padded);

    // Chunk BIN.
    glb.extend_from_slice(&(bin_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x004E4942u32.to_le_bytes()); // "BIN\0"
    glb.extend_from_slice(&bin_padded);

    glb
}

// ── Squelette et skinning dans le GLB (partagé par les deux writers) ─────────

/// Ajoute un bufferView + accessor sans min/max et renvoie l'index accessor.
fn glb_push_accessor(
    bv_data: &mut Vec<u8>,
    buffer_views_json: &mut Vec<serde_json::Value>,
    accessor_defs: &mut Vec<serde_json::Value>,
    raw: &[u8],
    count: usize,
    comp_type: u32,
    attr_type: &str,
) -> usize {
    use serde_json::json;
    let bv_offset = bv_data.len();
    bv_data.extend_from_slice(raw);
    while !bv_data.len().is_multiple_of(4) {
        bv_data.push(0);
    }
    let bv_idx = buffer_views_json.len();
    buffer_views_json.push(json!({
        "buffer": 0, "byteOffset": bv_offset, "byteLength": raw.len()
    }));
    let acc_idx = accessor_defs.len();
    accessor_defs.push(json!({
        "bufferView": bv_idx, "byteOffset": 0,
        "componentType": comp_type, "count": count, "type": attr_type
    }));
    acc_idx
}

/// Émet `JOINTS_0`/`WEIGHTS_0` (et `JOINTS_1`/`WEIGHTS_1` si un vertex porte plus de quatre
/// influences) pour une primitive skinnée. Les indices sont ceux de `skins[0].joints`, c'est-à-
/// dire l'ordre des os du squelette. Une primitive sans skin n'émet rien.
fn glb_emit_skin_attributes(
    prim: &MeshPrimitive,
    attrs_obj: &mut serde_json::Value,
    bv_data: &mut Vec<u8>,
    buffer_views_json: &mut Vec<serde_json::Value>,
    accessor_defs: &mut Vec<serde_json::Value>,
) {
    use serde_json::json;
    let Some(skin) = prim.skin.as_ref() else {
        return;
    };
    if skin.joints.len() != prim.positions.len() {
        return;
    }
    let sets = if skin.max_influences() > 4 { 2 } else { 1 };
    for set in 0..sets {
        let base = set * 4;
        let joints_raw: Vec<u8> = skin
            .joints
            .iter()
            .zip(&skin.weights)
            .flat_map(|(j, w)| {
                (base..base + 4).flat_map(move |k| {
                    // Un slot à poids nul pointe l'os 0 : c'est ce que la spec attend.
                    let joint = if w[k] > 0.0 { j[k] } else { 0 };
                    joint.to_le_bytes()
                })
            })
            .collect();
        let weights_raw: Vec<u8> = skin
            .weights
            .iter()
            .flat_map(|w| (base..base + 4).flat_map(move |k| w[k].to_le_bytes()))
            .collect();
        let j_acc = glb_push_accessor(
            bv_data,
            buffer_views_json,
            accessor_defs,
            &joints_raw,
            skin.joints.len(),
            5123,
            "VEC4",
        );
        let w_acc = glb_push_accessor(
            bv_data,
            buffer_views_json,
            accessor_defs,
            &weights_raw,
            skin.weights.len(),
            5126,
            "VEC4",
        );
        attrs_obj[format!("JOINTS_{set}")] = json!(j_acc);
        attrs_obj[format!("WEIGHTS_{set}")] = json!(w_acc);
    }
}

/// Attache le squelette du modèle au GLB : sépare dans chaque composant les primitives skinnées
/// des statiques (un nœud avec `skin` doit n'avoir que des primitives à `JOINTS_0`), émet un
/// nœud par os (TRS local de repos), `skins[0]` avec les matrices inverse-bind, et renvoie les
/// racines de scène (nœuds de maille + racines d'os), le tableau `skins` à insérer, et l'index du
/// PREMIER nœud d'os (`base` ci-dessous) — c'est ce que [`glb_emit_animations`] ajoute à
/// `DecodedMotionTrack::bone_index` pour cibler le bon nœud glTF.
fn glb_attach_skeleton(
    model: &AssembledModel,
    mesh_defs: &mut Vec<serde_json::Value>,
    mesh_nodes: &mut Vec<serde_json::Value>,
    bv_data: &mut Vec<u8>,
    buffer_views_json: &mut Vec<serde_json::Value>,
    accessor_defs: &mut Vec<serde_json::Value>,
) -> (Vec<usize>, Option<serde_json::Value>, Option<usize>) {
    use serde_json::{Value, json};

    let skinned_any = mesh_defs.iter().any(|m| {
        m["primitives"]
            .as_array()
            .is_some_and(|ps| ps.iter().any(|p| !p["attributes"]["JOINTS_0"].is_null()))
    });
    let Some(skeleton) = model.skeleton.as_ref().filter(|_| skinned_any) else {
        return ((0..mesh_nodes.len()).collect(), None, None);
    };

    // Scission skinné / statique par composant.
    let mut new_meshes: Vec<Value> = Vec::new();
    let mut new_nodes: Vec<Value> = Vec::new();
    for (mesh, node) in mesh_defs.iter().zip(mesh_nodes.iter()) {
        let name = mesh["name"].as_str().unwrap_or("Mesh").to_string();
        let prims = mesh["primitives"].as_array().cloned().unwrap_or_default();
        let (skinned, statics): (Vec<Value>, Vec<Value>) = prims
            .into_iter()
            .partition(|p| !p["attributes"]["JOINTS_0"].is_null());
        if !skinned.is_empty() {
            let idx = new_meshes.len();
            new_meshes.push(json!({ "name": name, "primitives": skinned }));
            let mut n = node.clone();
            n["name"] = json!(name);
            n["mesh"] = json!(idx);
            n["skin"] = json!(0);
            new_nodes.push(n);
        }
        if !statics.is_empty() {
            let idx = new_meshes.len();
            let static_name = format!("{name}_static");
            new_meshes.push(json!({ "name": static_name, "primitives": statics }));
            let mut n = node.clone();
            n["name"] = json!(static_name);
            n["mesh"] = json!(idx);
            new_nodes.push(n);
        }
    }
    *mesh_defs = new_meshes;
    *mesh_nodes = new_nodes;

    // Nœuds d'os, après les nœuds de maille.
    let base = mesh_nodes.len();
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); skeleton.bones.len()];
    let mut roots: Vec<usize> = Vec::new();
    for (i, b) in skeleton.bones.iter().enumerate() {
        match b.parent {
            Some(p) => children[p].push(base + i),
            None => roots.push(base + i),
        }
    }
    let mut ibm_raw: Vec<u8> = Vec::with_capacity(skeleton.bones.len() * 64);
    for (i, b) in skeleton.bones.iter().enumerate() {
        let mut node = json!({
            "name": b.name,
            "translation": b.local.translation,
            "rotation": b.local.quat,
            "scale": b.local.scale,
        });
        if !children[i].is_empty() {
            node["children"] = json!(children[i]);
        }
        mesh_nodes.push(node);
        for col in &b.inverse_bind {
            for v in col {
                ibm_raw.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    let ibm_acc = glb_push_accessor(
        bv_data,
        buffer_views_json,
        accessor_defs,
        &ibm_raw,
        skeleton.bones.len(),
        5126,
        "MAT4",
    );
    let joints: Vec<usize> = (0..skeleton.bones.len()).map(|i| base + i).collect();
    let mut skin = json!({
        "name": skeleton.source,
        "joints": joints,
        "inverseBindMatrices": ibm_acc,
    });
    if let Some(&root) = roots.first() {
        skin["skeleton"] = json!(root);
    }
    let mut scene_roots: Vec<usize> = (0..base).collect();
    scene_roots.extend(roots);
    (scene_roots, Some(json!([skin])), Some(base))
}

/// Construit `animations[]` depuis `model.animation_clips`, ciblant les nœuds d'os
/// `bone_node_base + DecodedMotionTrack::bone_index` (voir [`glb_attach_skeleton`]).
///
/// Un clip devient une entrée `animations[]` ; chaque piste animée devient jusqu'à trois canaux
/// (`translation`/`rotation`/`scale`), chacun avec son propre sampler `LINEAR` — glTF interdit à
/// un sampler d'alimenter plusieurs `path`. Les temps sont ceux, déjà en secondes, que
/// [`crate::g4mt::Motion::decode_clip`] a calculés depuis les frames et le FPS du clip source.
///
/// Renvoie aussi le JSON `extras.nie.animation` (présent dès que `animation_clips` ou
/// `animation_excluded` est non vide, même si le résultat final n'a AUCUNE piste exploitable —
/// un appelant qui a demandé un clip et n'a rien reçu doit pouvoir lire pourquoi).
fn glb_emit_animations(
    model: &AssembledModel,
    bone_node_base: Option<usize>,
    bv_data: &mut Vec<u8>,
    buffer_views_json: &mut Vec<serde_json::Value>,
    accessor_defs: &mut Vec<serde_json::Value>,
) -> (Option<serde_json::Value>, Option<serde_json::Value>) {
    use serde_json::{Value, json};

    if model.animation_clips.is_empty() && model.animation_excluded.is_empty() {
        return (None, None);
    }

    let mut animations: Vec<Value> = Vec::new();
    let mut included_names: Vec<Value> = Vec::new();
    // Un clip demandé mais sans squelette pour le porter est un troisième cas d'exclusion,
    // distinct de ceux que l'appelant a déjà classés (additif, cible non résolue) — il naît ICI,
    // pas dans `animation_excluded`, parce que seul ce point du pipeline sait qu'aucun os n'a de
    // nœud glTF cette fois-ci.
    let mut extra_excluded: Vec<Value> = Vec::new();

    if let Some(base) = bone_node_base {
        for clip in &model.animation_clips {
            let mut samplers: Vec<Value> = Vec::new();
            let mut channels: Vec<Value> = Vec::new();
            for track in &clip.tracks {
                if track.keyframes.is_empty() {
                    continue;
                }
                let node = base + track.bone_index;
                let frames = track.keyframes.len();

                // Une piste dont la valeur ne change JAMAIS se réduit à une seule image clé :
                // sous `LINEAR`, un sampler à un point rend cette valeur à tout instant, donc
                // la réduction est exacte et non une approximation. Sur un squelette, la
                // translation et l'échelle sont constantes pour presque tous les os, et les
                // émettre image par image multipliait le GLB par plus de dix.
                //
                // La comparaison est BIT à BIT : au moindre frémissement, on garde la piste
                // entière. Une tolérance ferait entrer une perte silencieuse ici, alors que le
                // seul gain visé est de ne pas répéter une valeur identique.
                let t_vals: Vec<[f32; 3]> =
                    track.keyframes.iter().map(|k| k.pose.translation).collect();
                let r_vals: Vec<[f32; 4]> = track.keyframes.iter().map(|k| k.pose.quat).collect();
                let s_vals: Vec<[f32; 3]> = track.keyframes.iter().map(|k| k.pose.scale).collect();
                let constant = |raw: &[&[f32]]| {
                    raw.windows(2).all(|w| {
                        w[0].iter()
                            .map(|c| c.to_bits())
                            .eq(w[1].iter().map(|c| c.to_bits()))
                    })
                };
                let t_const = constant(&t_vals.iter().map(|v| &v[..]).collect::<Vec<_>>());
                let r_const = constant(&r_vals.iter().map(|v| &v[..]).collect::<Vec<_>>());
                let s_const = constant(&s_vals.iter().map(|v| &v[..]).collect::<Vec<_>>());

                let first_time = track.keyframes.first().map_or(0.0, |k| k.time_seconds);
                // glTF EXIGE min/max sur l'accessor d'entrée d'un sampler d'animation — sans eux
                // un validateur strict rejette le fichier entier, pas seulement l'animation.
                let mut push_times = |values: &[f32]| {
                    let raw: Vec<u8> = values.iter().flat_map(|t| t.to_le_bytes()).collect();
                    let acc = glb_push_accessor(
                        bv_data,
                        buffer_views_json,
                        accessor_defs,
                        &raw,
                        values.len(),
                        5126,
                        "SCALAR",
                    );
                    if let Some(def) = accessor_defs.get_mut(acc) {
                        def["min"] = json!([values.first().copied().unwrap_or(0.0)]);
                        def["max"] = json!([values.last().copied().unwrap_or(0.0)]);
                    }
                    acc
                };
                // Chaque accessor de temps n'est créé que s'il sert : un GLB ne doit pas porter
                // une table de 300 instants qu'aucun sampler ne lit.
                let full_time_acc = (!(t_const && r_const && s_const)).then(|| {
                    let times: Vec<f32> = track.keyframes.iter().map(|k| k.time_seconds).collect();
                    push_times(&times)
                });
                let single_time_acc =
                    (t_const || r_const || s_const).then(|| push_times(&[first_time]));

                let mut push_channel =
                    |path: &str, raw: Vec<u8>, count: usize, ty: &str, is_const: bool| {
                        let Some(time_acc) = (if is_const {
                            single_time_acc
                        } else {
                            full_time_acc
                        }) else {
                            return;
                        };
                        let out_acc = glb_push_accessor(
                            bv_data,
                            buffer_views_json,
                            accessor_defs,
                            &raw,
                            count,
                            5126,
                            ty,
                        );
                        let sampler_idx = samplers.len();
                        samplers.push(json!({
                            "input": time_acc, "output": out_acc, "interpolation": "LINEAR"
                        }));
                        channels.push(json!({
                            "sampler": sampler_idx, "target": { "node": node, "path": path }
                        }));
                    };

                let pack = |values: &[&[f32]]| -> Vec<u8> {
                    values
                        .iter()
                        .flat_map(|v| v.iter().flat_map(|c| c.to_le_bytes()))
                        .collect()
                };
                let keep = |n: bool| if n { 1 } else { frames };

                let t_slice: Vec<&[f32]> =
                    t_vals.iter().take(keep(t_const)).map(|v| &v[..]).collect();
                push_channel(
                    "translation",
                    pack(&t_slice),
                    keep(t_const),
                    "VEC3",
                    t_const,
                );

                // `LocalTrs::quat` est déjà ordonné (x, y, z, w), l'ordre que glTF attend pour
                // ROTATION — aucune permutation à faire ici.
                let r_slice: Vec<&[f32]> =
                    r_vals.iter().take(keep(r_const)).map(|v| &v[..]).collect();
                push_channel("rotation", pack(&r_slice), keep(r_const), "VEC4", r_const);

                let s_slice: Vec<&[f32]> =
                    s_vals.iter().take(keep(s_const)).map(|v| &v[..]).collect();
                push_channel("scale", pack(&s_slice), keep(s_const), "VEC3", s_const);
            }
            if channels.is_empty() {
                extra_excluded.push(json!({
                    "name": clip.name,
                    "reason": "aucune piste exploitable (toutes les cibles résolues étaient vides)",
                }));
                continue;
            }
            included_names.push(json!(clip.name));
            animations.push(json!({
                "name": clip.name,
                "channels": channels,
                "samplers": samplers,
            }));
        }
    } else if !model.animation_clips.is_empty() {
        for clip in &model.animation_clips {
            extra_excluded.push(json!({
                "name": clip.name,
                "reason": "pas de squelette skinné dans ce GLB : rien à animer",
            }));
        }
    }

    let mut excluded: Vec<Value> = model
        .animation_excluded
        .iter()
        .map(|e| json!({ "name": e.name, "reason": e.reason }))
        .collect();
    excluded.extend(extra_excluded);

    let extras = json!({
        "included": included_names,
        "excluded": excluded,
    });
    let animations_json = if animations.is_empty() {
        None
    } else {
        Some(json!(animations))
    };
    (animations_json, Some(extras))
}

// ── Export GLB avec textures embarquées ──────────────────────────────────────

/// Construit un GLB avec les textures PNG **embarquées** dans le buffer BIN.
///
/// Chaque [`EmbeddedTexture`] dans `model.embedded_textures` est injectée comme un
/// `bufferView` supplémentaire dans le BIN chunk. Les primitives dont le composant correspond
/// à une texture embarquée reçoivent un matériau PBR avec `baseColorTexture` liant à cette
/// image. Les primitives sans texture embarquée gardent le matériau `Default`.
///
/// La correspondance composant → texture est par [`MeshComponent`] : la première texture
/// embarquée du composant correspondant est utilisée. Les GLBs pré-convertis (Body) et les
/// primitives sans texture embarquée (material_name vide + pas d'embedded_texture pour ce
/// composant) gardent le matériau Default.
fn build_glb_embedded(model: &AssembledModel) -> Vec<u8> {
    use serde_json::{Value, json};

    // Buffer binaire accumulant toutes les données (positions/normales/UV/indices + PNG).
    let mut bv_data: Vec<u8> = Vec::new();
    let mut accessor_defs: Vec<Value> = Vec::new();
    let mut buffer_views_json: Vec<Value> = Vec::new();

    #[allow(clippy::too_many_arguments)]
    fn add_accessor(
        bv_data: &mut Vec<u8>,
        buffer_views_json: &mut Vec<Value>,
        accessor_defs: &mut Vec<Value>,
        raw: &[u8],
        count: usize,
        comp_type: u32,
        attr_type: &str,
        min_val: Option<Value>,
        max_val: Option<Value>,
    ) -> usize {
        let bv_offset = bv_data.len();
        bv_data.extend_from_slice(raw);
        while !bv_data.len().is_multiple_of(4) {
            bv_data.push(0);
        }
        let bv_idx = buffer_views_json.len();
        buffer_views_json.push(json!({
            "buffer": 0, "byteOffset": bv_offset, "byteLength": raw.len()
        }));
        let acc_idx = accessor_defs.len();
        let mut acc = json!({
            "bufferView": bv_idx, "byteOffset": 0,
            "componentType": comp_type, "count": count, "type": attr_type
        });
        if let Some(mn) = min_val {
            acc["min"] = mn;
        }
        if let Some(mx) = max_val {
            acc["max"] = mx;
        }
        accessor_defs.push(acc);
        acc_idx
    }

    // ── Injection des textures PNG dans le buffer BIN ─────────────────────────
    // Les bufferViews des textures PNG ont un `target` absent (non vertex data).
    // Map component → (image_index, texture_index, material_index).
    let mut comp_to_mat: std::collections::HashMap<u8, usize> = std::collections::HashMap::new();
    // Matching PAR NOM (texture embarquée → matériau), pour les modèles multi-matériaux (maps) :
    // une primitive dont `material_name` égale le nom d'une texture utilise CE matériau. Additif —
    // si aucun nom ne matche (perso, dont les noms diffèrent), on retombe sur le mapping component.
    let mut name_to_mat: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut image_defs: Vec<Value> = Vec::new();
    let mut texture_defs: Vec<Value> = Vec::new();
    let mut material_defs: Vec<Value> = Vec::new();

    // Matériau 0 : Default (pour Body et primitives sans texture).
    material_defs.push(json!({
        "name": "Default",
        "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": 0.0, "roughnessFactor": 1.0
        }
    }));

    for etex in &model.embedded_textures {
        // Injecte les bytes PNG dans le BIN (aligné 4B).
        let png_off = bv_data.len();
        bv_data.extend_from_slice(&etex.png_bytes);
        while !bv_data.len().is_multiple_of(4) {
            bv_data.push(0);
        }

        let bv_idx = buffer_views_json.len();
        buffer_views_json.push(json!({
            "buffer": 0,
            "byteOffset": png_off,
            "byteLength": etex.png_bytes.len()
        }));

        let img_idx = image_defs.len();
        image_defs.push(json!({
            "bufferView": bv_idx,
            "mimeType": "image/png",
            "name": etex.name
        }));

        let tex_idx = texture_defs.len();
        texture_defs.push(json!({ "source": img_idx, "name": etex.name, "sampler": 0 }));

        let mat_idx = material_defs.len();
        // `alphaMode` absent vaut OPAQUE en glTF : le canal alpha de la texture est alors
        // purement et simplement IGNORÉ au rendu. Toute la composition du visage repose pourtant
        // sur lui — la couche des yeux ne couvre que 17 % de sa planche, le reste devant laisser
        // voir la peau — et les mèches de chevelure sont découpées par leur masque. Sans ce
        // champ, ces alphas étaient calculés puis jetés.
        //
        // Les composants opaques utilisent MASK afin d'éviter le tri par profondeur ; le visage
        // translucide est traité en BLEND ci-dessous pour conserver l'anti-crénelage.
        let alpha_mode = match etex.component {
            MeshComponent::Face => "BLEND",
            _ => "MASK",
        };
        // Une texture opaque doit écrire la profondeur, même sur une pièce Face : le tri
        // des triangles d'une chevelure en BLEND provoque des auto-superpositions noires.
        #[cfg(feature = "textures")]
        let alpha_mode = if png_is_opaque(&etex.png_bytes) == Some(true) {
            "OPAQUE"
        } else {
            alpha_mode
        };
        let mut material = json!({
            "name": etex.name,
            "pbrMetallicRoughness": {
                "baseColorTexture": { "index": tex_idx },
                "metallicFactor": 0.0, "roughnessFactor": 1.0
            },
            "alphaMode": alpha_mode,
            "doubleSided": true
        });
        if alpha_mode == "MASK" {
            material["alphaCutoff"] = json!(0.5);
        }
        material_defs.push(material);

        // Encode le composant en u8 pour la map.
        let comp_key = match etex.component {
            MeshComponent::Body => 0u8,
            MeshComponent::Face => 1u8,
            MeshComponent::Uniform => 2u8,
            MeshComponent::Keshin => 3u8,
            MeshComponent::Armed => 4u8,
            MeshComponent::Generic => 5u8,
        };
        // N'insère que la première texture pour chaque composant.
        comp_to_mat.entry(comp_key).or_insert(mat_idx);
        // Index par nom (pour le matching matériau des maps).
        name_to_mat.entry(etex.name.clone()).or_insert(mat_idx);
    }

    // ── Textures auxiliaires du shader Character ─────────────────────────────
    // glTF ne sait représenter que l'occlusion (canal R de `occlusionTexture`). Les autres
    // rôles (`line`, `msk`, `sp`, `spm`) sont embarqués et déclarés dans `extras.nie` du
    // matériau, avec leur nom d'origine : un importateur qui connaît le shader Character peut les
    // rebrancher, et personne ne peut croire à une équivalence PBR qui n'existe pas.
    for aux in &model.aux_textures {
        let Some(&mat_idx) = name_to_mat.get(&aux.material) else {
            continue;
        };
        let png_off = bv_data.len();
        bv_data.extend_from_slice(&aux.png_bytes);
        while !bv_data.len().is_multiple_of(4) {
            bv_data.push(0);
        }
        let bv_idx = buffer_views_json.len();
        buffer_views_json.push(json!({
            "buffer": 0, "byteOffset": png_off, "byteLength": aux.png_bytes.len()
        }));
        let img_idx = image_defs.len();
        image_defs.push(json!({ "bufferView": bv_idx, "mimeType": "image/png", "name": aux.name }));
        let tex_idx = texture_defs.len();
        texture_defs.push(json!({ "source": img_idx, "name": aux.name, "sampler": 0 }));
        let material = &mut material_defs[mat_idx];
        if aux.role == "occlusion" {
            material["occlusionTexture"] = json!({ "index": tex_idx });
        }
        if material["extras"]["nie"].is_null() {
            material["extras"] = json!({ "nie": { "shader": "Character", "textures": {} } });
        }
        material["extras"]["nie"]["textures"][&aux.role] =
            json!({ "texture": tex_idx, "name": aux.name });
    }

    // ── Parcours des composants (identique à build_glb) ──────────────────────
    let components_order = [
        MeshComponent::Body,
        MeshComponent::Face,
        MeshComponent::Uniform,
        MeshComponent::Keshin,
        MeshComponent::Armed,
        MeshComponent::Generic,
    ];
    let mut mesh_nodes: Vec<Value> = Vec::new();
    let mut mesh_defs: Vec<Value> = Vec::new();

    for comp in components_order {
        let comp_prims: Vec<&MeshPrimitive> = model
            .primitives
            .iter()
            .filter(|p| p.component == comp)
            .collect();
        if comp_prims.is_empty() {
            continue;
        }

        let comp_key = match comp {
            MeshComponent::Body => 0u8,
            MeshComponent::Face => 1u8,
            MeshComponent::Uniform => 2u8,
            MeshComponent::Keshin => 3u8,
            MeshComponent::Armed => 4u8,
            MeshComponent::Generic => 5u8,
        };
        let comp_name = match comp {
            MeshComponent::Body => "Body",
            MeshComponent::Face => "Face",
            MeshComponent::Uniform => "Uniform",
            MeshComponent::Keshin => "Keshin",
            MeshComponent::Armed => "Armed",
            MeshComponent::Generic => "Generic",
        };

        let mut prim_defs: Vec<Value> = Vec::new();
        for prim in &comp_prims {
            if prim.positions.is_empty() {
                continue;
            }

            // Positions → VEC3 float32.
            let pos_raw: Vec<u8> = prim
                .positions
                .iter()
                .flat_map(|v| [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes()].concat())
                .collect();
            let p_min: Vec<f32> = vec![
                prim.positions
                    .iter()
                    .map(|v| v.x)
                    .fold(f32::INFINITY, f32::min),
                prim.positions
                    .iter()
                    .map(|v| v.y)
                    .fold(f32::INFINITY, f32::min),
                prim.positions
                    .iter()
                    .map(|v| v.z)
                    .fold(f32::INFINITY, f32::min),
            ];
            let p_max: Vec<f32> = vec![
                prim.positions
                    .iter()
                    .map(|v| v.x)
                    .fold(f32::NEG_INFINITY, f32::max),
                prim.positions
                    .iter()
                    .map(|v| v.y)
                    .fold(f32::NEG_INFINITY, f32::max),
                prim.positions
                    .iter()
                    .map(|v| v.z)
                    .fold(f32::NEG_INFINITY, f32::max),
            ];
            let pos_acc = add_accessor(
                &mut bv_data,
                &mut buffer_views_json,
                &mut accessor_defs,
                &pos_raw,
                prim.positions.len(),
                5126,
                "VEC3",
                Some(json!(p_min)),
                Some(json!(p_max)),
            );

            let normal_acc = if !prim.normals.is_empty() {
                let raw: Vec<u8> = prim
                    .normals
                    .iter()
                    .flat_map(|v| {
                        [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes()].concat()
                    })
                    .collect();
                Some(add_accessor(
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                    &raw,
                    prim.normals.len(),
                    5126,
                    "VEC3",
                    None,
                    None,
                ))
            } else {
                None
            };

            let uv_acc = if !prim.uv0.is_empty() {
                let raw: Vec<u8> = prim
                    .uv0
                    .iter()
                    .flat_map(|v| {
                        let mut b = [0u8; 8];
                        b[..4].copy_from_slice(&v.u.to_le_bytes());
                        b[4..].copy_from_slice(&v.v.to_le_bytes());
                        b
                    })
                    .collect();
                Some(add_accessor(
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                    &raw,
                    prim.uv0.len(),
                    5126,
                    "VEC2",
                    None,
                    None,
                ))
            } else {
                None
            };

            // Colors → VEC4 float32 (5126), optionnel.
            let _color_acc = if !prim.colors.is_empty() {
                let raw: Vec<u8> = prim
                    .colors
                    .iter()
                    .flat_map(|v| {
                        [
                            v.x.to_le_bytes(),
                            v.y.to_le_bytes(),
                            v.z.to_le_bytes(),
                            v.w.to_le_bytes(),
                        ]
                        .concat()
                    })
                    .collect();
                Some(add_accessor(
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                    &raw,
                    prim.colors.len(),
                    5126,
                    "VEC4",
                    None,
                    None,
                ))
            } else {
                None
            };

            let use_u32 = prim.positions.len() > 65535;
            let (idx_comp_type, idx_raw): (u32, Vec<u8>) = if use_u32 {
                (
                    5125,
                    prim.indices.iter().flat_map(|&i| i.to_le_bytes()).collect(),
                )
            } else {
                (
                    5123,
                    prim.indices
                        .iter()
                        .flat_map(|&i| (i as u16).to_le_bytes())
                        .collect(),
                )
            };
            let mut idx_raw_padded = idx_raw;
            while idx_raw_padded.len() % 4 != 0 {
                idx_raw_padded.push(0);
            }
            let idx_acc = add_accessor(
                &mut bv_data,
                &mut buffer_views_json,
                &mut accessor_defs,
                &idx_raw_padded,
                prim.indices.len(),
                idx_comp_type,
                "SCALAR",
                None,
                None,
            );

            // Matériau : utilise la texture embarquée du composant, sinon Default (0).
            // Priorité au matching par NOM (maps multi-matériaux) ; sinon mapping component (perso).
            let mat_idx = name_to_mat
                .get(&prim.material_name)
                .copied()
                .or_else(|| {
                    if model.strict_materials && !prim.material_name.is_empty() {
                        None
                    } else {
                        comp_to_mat.get(&comp_key).copied()
                    }
                })
                .unwrap_or(0);

            let mut attrs_obj = json!({ "POSITION": pos_acc });
            if let Some(n) = normal_acc {
                attrs_obj["NORMAL"] = json!(n);
            }
            if let Some(u) = uv_acc {
                attrs_obj["TEXCOORD_0"] = json!(u);
            }
            if model.skeleton.is_some() {
                glb_emit_skin_attributes(
                    prim,
                    &mut attrs_obj,
                    &mut bv_data,
                    &mut buffer_views_json,
                    &mut accessor_defs,
                );
            }
            // Desactive COLOR_0 pour eviter que les shaders standards n'appliquent des couleurs de debug/masquage
            // if let Some(c) = color_acc { attrs_obj["COLOR_0"] = json!(c); }

            prim_defs.push(json!({
                "attributes": attrs_obj,
                "indices": idx_acc,
                "material": mat_idx,
                "mode": 4
            }));
        }

        if prim_defs.is_empty() {
            continue;
        }

        let mesh_idx = mesh_defs.len();
        mesh_defs.push(json!({ "name": comp_name, "primitives": prim_defs }));
        mesh_nodes.push(json!({ "name": comp_name, "mesh": mesh_idx }));
    }

    let (node_indices, skins_json, bone_node_base) = glb_attach_skeleton(
        model,
        &mut mesh_defs,
        &mut mesh_nodes,
        &mut bv_data,
        &mut buffer_views_json,
        &mut accessor_defs,
    );
    let (animations_json, animation_extras) = glb_emit_animations(
        model,
        bone_node_base,
        &mut bv_data,
        &mut buffer_views_json,
        &mut accessor_defs,
    );

    // ── JSON glTF ─────────────────────────────────────────────────────────────
    let mut gltf_obj = json!({
        "asset": { "version": "2.0", "generator": "aphrody-nie-formats assemble.rs embedded" },
        "accessors": accessor_defs,
        "bufferViews": buffer_views_json,
        "buffers": [{ "byteLength": bv_data.len() }],
        "materials": material_defs,
        "meshes": mesh_defs,
        "nodes": mesh_nodes,
        "scene": 0,
        "scenes": [{ "nodes": node_indices }]
    });
    if let Some(skins) = skins_json {
        gltf_obj["skins"] = skins;
    }
    if let Some(animations) = animations_json {
        gltf_obj["animations"] = animations;
    }
    if let Some(extras) = animation_extras {
        gltf_obj["extras"] = json!({ "nie": { "animation": extras } });
    }

    if !image_defs.is_empty() {
        gltf_obj["images"] = json!(image_defs);
        gltf_obj["textures"] = json!(texture_defs);
        // Wrap CLAMP_TO_EDGE (33071) au lieu du REPEAT par défaut : certains maillages (visage/
        // cheveux) ont des UV hors [0,1] (ex. face mesh en [-1,1]) → en REPEAT l'atlas se RÉPÈTE
        // sur toute la tête (visages/yeux tuilés, y compris à l'arrière). CLAMP fige sur le bord.
        gltf_obj["samplers"] = json!([{ "wrapS": 33071, "wrapT": 33071 }]);
    }

    // ── Sérialisation GLB ─────────────────────────────────────────────────────
    let json_bytes = gltf_obj.to_string().into_bytes();
    let json_padded_len = (json_bytes.len() + 3) & !3;
    let mut json_padded = json_bytes;
    while json_padded.len() < json_padded_len {
        json_padded.push(0x20);
    }

    let bin_padded_len = (bv_data.len() + 3) & !3;
    let mut bin_padded = bv_data;
    while bin_padded.len() < bin_padded_len {
        bin_padded.push(0);
    }

    let total_len = 12 + 8 + json_padded_len + 8 + bin_padded_len;
    let mut glb: Vec<u8> = Vec::with_capacity(total_len);

    glb.extend_from_slice(&0x46546C67u32.to_le_bytes());
    glb.extend_from_slice(&2u32.to_le_bytes());
    glb.extend_from_slice(&(total_len as u32).to_le_bytes());
    glb.extend_from_slice(&(json_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
    glb.extend_from_slice(&json_padded);
    glb.extend_from_slice(&(bin_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x004E4942u32.to_le_bytes());
    glb.extend_from_slice(&bin_padded);

    glb
}

#[cfg(feature = "textures")]
fn png_is_opaque(bytes: &[u8]) -> Option<bool> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().ok()?;
    let size = reader.output_buffer_size()?;
    if size > 256 * 1024 * 1024 {
        return None;
    }
    let mut pixels = vec![0; size];
    let info = reader.next_frame(&mut pixels).ok()?;
    let pixels = &pixels[..info.buffer_size()];
    Some(match info.color_type {
        png::ColorType::Rgba => pixels.as_chunks::<4>().0.iter().all(|p| p[3] == 255),
        png::ColorType::GrayscaleAlpha => pixels.as_chunks::<2>().0.iter().all(|p| p[1] == 255),
        png::ColorType::Rgb | png::ColorType::Grayscale => true,
        png::ColorType::Indexed => return None,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn primitive_test(component: MeshComponent, material_name: &str, ys: &[f32]) -> MeshPrimitive {
        MeshPrimitive {
            component,
            source_index: 0,
            material_index: 0,
            material_name: material_name.into(),
            texture_uri: String::new(),
            positions: ys
                .iter()
                .enumerate()
                .map(|(i, &y)| g4mg::Vec3 {
                    x: i as f32,
                    y,
                    z: 0.0,
                })
                .collect(),
            normals: Vec::new(),
            uv0: Vec::new(),
            colors: Vec::new(),
            indices: vec![0, 1, 2],
            skin: None,
            piece: String::new(),
        }
    }

    #[test]
    fn le_suffixe_de_niveau_de_detail_ne_nomme_pas_la_texture() {
        // Un matériau d'uniforme porte le LOD, la texture du conteneur ne le porte pas.
        assert_eq!(avatar_texture_name("u000101_30_LOD1"), "u000101_30");
        assert_eq!(avatar_texture_name("s000201_10_LOD1"), "s000201_10");
        // Un matériau de l'éditeur nomme déjà la texture : rien à retirer.
        assert_eq!(avatar_texture_name("hairF_10"), "hairF_10");
        assert_eq!(avatar_texture_name("eye_10_normal_00"), "eye_10_normal_00");
    }

    #[test]
    fn les_coiffures_essaient_le_suffixe_m_avant_la_forme_nue() {
        let c = avatar_texture_candidates("_hairF", "hairF001");
        assert_eq!(c[0], "data/dx11/chr/_face/20_EDIT/_hairF/hairF001M.g4tx");
        assert_eq!(c[1], "data/dx11/chr/_face/20_EDIT/_hairF/hairF001.g4tx");
    }

    #[test]
    fn le_visage_et_l_accessoire_partagent_un_conteneur_unique() {
        // 64 modèles de visage pour un seul .g4tx, 44 accessoires pour un seul.
        assert_eq!(
            avatar_texture_candidates("_facebase", "face01_nose01"),
            ["data/dx11/chr/_face/20_EDIT/_facebase/_facebase.g4tx"]
        );
        assert_eq!(
            avatar_texture_candidates("_accessory", "accessory001"),
            ["data/dx11/chr/_face/20_EDIT/_accessorytex/accessory_10.g4tx"]
        );
    }

    #[test]
    fn l_oreille_n_a_aucune_texture_propre() {
        assert!(avatar_texture_candidates("_ear", "ear001").is_empty());
    }

    #[test]
    fn le_conteneur_d_uniforme_porte_la_tenue_pas_le_modele() {
        // Le modèle est u000101, la tenue de l'éditeur u117401_10.
        assert_eq!(
            uniform_texture_vfs_path("u000101", "u117401_10"),
            "data/dx11/chr/_uniform/u000101/u117401_10.g4tx"
        );
    }

    /// Dossier des GLB de référence, sous la racine de jeu résolue à l'exécution — aucun
    /// chemin de poste en dur : `NIE_GAME_DIR`, sinon le répertoire courant ou un ancêtre.
    /// Les GLB sont des artefacts **produits** par ce dépôt (`var/glb/`), pas des
    /// fichiers livrés par le jeu : `data/dx11/model` ne contient pas de GLB.
    /// `NIE_GLB_DIR` permet de pointer un autre répertoire de sortie.
    fn glb_dir() -> PathBuf {
        if let Ok(d) = std::env::var("NIE_GLB_DIR") {
            return PathBuf::from(d);
        }
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .expect("racine du dépôt")
            .join("var/glb")
    }

    fn glb_exists(name: &str) -> bool {
        glb_dir().join(format!("{name}.glb")).exists()
    }

    // ── Tests unitaires (pas d'accès disque) ─────────────────────────────────

    #[test]
    fn type_idx_mapping_couvre_0_a_17() {
        // Tous les type_idx 0..17 doivent avoir un GLB.
        for i in 0u8..=17 {
            assert!(
                type_idx_to_glb_name(i).is_some(),
                "type_idx={i} sans GLB base — vérifier la table TYPE_IDX_TO_GLB"
            );
        }
    }

    #[test]
    fn type_idx_101_201_sans_glb() {
        assert!(
            type_idx_to_glb_name(101).is_none(),
            "animal n'a pas de GLB base"
        );
        assert!(
            type_idx_to_glb_name(201).is_none(),
            "vehicle n'a pas de GLB base"
        );
        assert!(
            type_idx_to_glb_name(255).is_none(),
            "inconnu n'a pas de GLB base"
        );
    }

    #[test]
    fn season_key_depuis_series() {
        // Vérifiés sur les valeurs réelles de inagle_characters.series.
        assert_eq!(SeasonKey::from_series("Inazuma Eleven"), SeasonKey::Ie);
        assert_eq!(SeasonKey::from_series("Inazuma Eleven 2"), SeasonKey::Ie);
        assert_eq!(SeasonKey::from_series("Inazuma Eleven GO"), SeasonKey::Go);
        assert_eq!(SeasonKey::from_series("ARES"), SeasonKey::Go);
        assert_eq!(SeasonKey::from_series("Victory Road"), SeasonKey::V);
        assert_eq!(
            SeasonKey::from_series("Inazuma Eleven: Victory Road"),
            SeasonKey::V
        );
        // Valeur inconnue → Ie par défaut.
        assert_eq!(SeasonKey::from_series("Unknown"), SeasonKey::Ie);
    }

    #[test]
    fn season_key_as_str() {
        assert_eq!(SeasonKey::Ie.as_str(), "ie");
        assert_eq!(SeasonKey::Go.as_str(), "go");
        assert_eq!(SeasonKey::V.as_str(), "v");
    }

    #[test]
    fn uniform_model_entry_selection_position() {
        let entry = UniformModelEntry {
            type_id: 0,
            fielder_crc: 0x9D2BBD10,
            keeper_crc: 0x55CB3260,
        };
        assert_eq!(entry.crc_for_position(FieldPosition::Fielder), 0x9D2BBD10);
        assert_eq!(
            entry.crc_for_position(FieldPosition::Goalkeeper),
            0x55CB3260
        );
        assert_eq!(entry.crc_for_position(FieldPosition::Manager), 0x9D2BBD10);
    }

    #[test]
    fn assemble_error_no_base_glb() {
        let input = CharacterAssemblyInput {
            internal_code: "c01000010".into(),
            body_type_idx: 101, // animal → pas de GLB
            glb_dir: glb_dir(),
            uniform_model_crc: 0,
            uniform_g4md: None,
            uniform_g4mg: None,
            uniform_glb_path: None,
            uniform_parts: Vec::new(),
            body_raw: None,
            face_raw: None,
            skeleton: None,
        };
        let result = assemble_character_model(&input);
        assert!(
            matches!(result, Err(AssembleError::NoBaseGlb(101))),
            "type_idx=101 doit renvoyer NoBaseGlb"
        );
    }

    // ── Tests d'intégration réels (nécessitent GLB sur le VPS) ───────────────

    /// Vérifie que les GLBs de corps partagés existent pour les 4 meshes de base.
    #[test]
    fn glb_bodies_partagees_existent() {
        if !glb_dir().exists() {
            eprintln!("SKIP : répertoire GLB absent");
            return;
        }
        for name in [
            "base_normal_00",
            "base_normal_01",
            "base_normal_02",
            "base_normal_03",
            "base_tall_00",
            "base_big_00",
            "base_small_00",
        ] {
            assert!(glb_exists(name), "GLB manquant : {name}.glb");
        }
    }

    /// Assemblage complet de c01000010 (Endou Mamoru IE1) sans uniforme.
    ///
    /// Vérifie :
    /// - Corps (base_normal_00) + Visage (c01000010) chargés.
    /// - Nombre de vertices cohérent avec les valeurs réelles mesurées.
    /// - Pas de primitives uniforme (aucune donnée fournie).
    /// - Export GLB valide (magic correct, non vide).
    #[test]
    fn assemblage_c01000010_corps_face_sans_uniforme() {
        if !glb_dir().exists() {
            eprintln!("SKIP : répertoire GLB absent ({})", glb_dir().display());
            return;
        }
        if !glb_exists("c01000010") || !glb_exists("base_normal_00") {
            eprintln!("SKIP : GLBs manquants");
            return;
        }

        // c01000010 : type_idx=0 → base_normal_00
        // (vérifié : CHARA_BODY_INFO[bodyInfoId=613579].var[4]=0)
        let input = CharacterAssemblyInput {
            internal_code: "c01000010".into(),
            body_type_idx: 0,
            glb_dir: glb_dir(),
            uniform_model_crc: 0x9D2BBD10, // Raimon fielder (réel)
            uniform_g4md: None,
            uniform_g4mg: None,
            uniform_glb_path: None,
            uniform_parts: Vec::new(),
            body_raw: None,
            face_raw: None,
            skeleton: None,
        };

        let model = assemble_character_model(&input).expect("assemblage c01000010");

        // Corps : 2 primitives. Compte ancré sur le g4md du jeu
        // (data/common/chr/_face/20_EDIT/_base/base_normal_00.g4md : sm[0] vtx=365,
        // sm[1] vtx=38), et non sur un GLB non versionné. L'attente précédente
        // (321+36=357) venait d'un exporteur qui soude les sommets ; le pipeline du
        // dépôt (assemble_generic_model) préserve les comptes du g4md.
        let body_verts: usize = model.body_primitives().map(|p| p.vertex_count()).sum();
        assert_eq!(
            body_verts, 403,
            "corps base_normal_00 : 403 vertices attendus (365+38, cf. g4md)"
        );

        // Visage : 3 primitives. Compte ancré sur le g4md du jeu
        // (data/common/chr/_face/01_IE1/c01000010/c01000010.g4md : 880+406+72).
        let face_verts: usize = model.face_primitives().map(|p| p.vertex_count()).sum();
        assert_eq!(
            face_verts, 1358,
            "visage c01000010 : 1358 vertices attendus (880+406+72, cf. g4md)"
        );

        // Aucun uniforme fourni.
        assert_eq!(
            model.uniform_primitives().count(),
            0,
            "pas d'uniforme fourni"
        );

        // Total = 403 + 1358 = 1761. Les triangles ci-dessous (1754) dérivent des
        // mêmes g4md et n'ont pas bougé : la soudure de sommets de l'ancien
        // exporteur ne changeait que les comptes de sommets.
        assert_eq!(model.total_vertex_count(), 1761, "total vertices : 1761");

        // Triangles du visage : 3390/3 + 1536/3 + 336/3 = 1130+512+112 = 1754
        let face_tris: usize = model.face_primitives().map(|p| p.triangle_count()).sum();
        assert_eq!(face_tris, 1754, "triangles visage : 1754");

        // Métadonnées.
        assert_eq!(model.internal_code, "c01000010");
        assert_eq!(model.body_glb, "base_normal_00");
        assert_eq!(model.uniform_crc, 0x9D2BBD10);

        // Export GLB : magic "glTF" + taille non nulle.
        let glb = model.to_glb();
        assert!(glb.len() > 12, "GLB exporté non vide");
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67, "magic GLB valide");

        // Version 2.
        let version = u32::from_le_bytes([glb[4], glb[5], glb[6], glb[7]]);
        assert_eq!(version, 2);

        // Total length cohérent.
        let total_len = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total_len, glb.len(), "total_length GLB = taille buffer");

        eprintln!(
            "PASS c01000010 : corps={body_verts}v, face={face_verts}v, total={}v, glb={}B",
            model.total_vertex_count(),
            glb.len()
        );
    }

    /// Vérifie la chaîne de matching complète pour Endou Mamoru (c01000010, IE1) :
    ///
    /// Raimon → kits.ie = 0x252CE113 → m_UniformInfoList[nameId=0x252CE113].modelInfo=[0,2]
    /// → m_UniformModelInfoList[0].uniformFielderModelIdCrc = 0x9D2BBD10
    ///
    /// Valeurs vérifiées sur les fichiers JSON gamedata réels.
    #[test]
    fn chaine_matching_uniforme_raimon_ie1() {
        // Données issues de uniform_config_1.03.52.00.cfg.bin.json (réel)
        // m_UniformInfoList[0] = nameId=0x252CE113, modelInfo=[0,2]
        // m_UniformModelInfoList[0] = fielder=0x9D2BBD10, keeper=0x55CB3260
        let kit_id_str = "0x252CE113";
        let kit_id: u32 = u32::from_str_radix(&kit_id_str[2..], 16).unwrap();

        // Simule la résolution : on cherche le kit_id dans m_UniformInfoList.
        // On vérifie que le CRC fielder correspond à la valeur réelle mesurée.
        let expected_fielder: u32 = 0x9D2BBD10;
        let expected_keeper: u32 = 0x55CB3260;

        // Entry correspondant à la saison IE (type_id=0 pour le fielder standard).
        let entry = UniformModelEntry {
            type_id: 0,
            fielder_crc: expected_fielder,
            keeper_crc: expected_keeper,
        };

        assert_eq!(entry.crc_for_position(FieldPosition::Fielder), 0x9D2BBD10);
        assert_eq!(
            entry.crc_for_position(FieldPosition::Goalkeeper),
            0x55CB3260
        );

        // La saison d'Endou (IE1) → SeasonKey::Ie → "ie".
        let key = SeasonKey::from_series("Inazuma Eleven");
        assert_eq!(key.as_str(), "ie");

        // kit_id = kits["ie"] = 0x252CE113.
        assert_eq!(kit_id, 0x252CE113);
    }

    /// Vérifie que l'export GLB d'un modèle vide (0 primitives) est syntaxiquement valide.
    #[test]
    fn export_glb_modele_vide_valide() {
        let model = AssembledModel {
            internal_code: "test".into(),
            body_glb: "base_normal_00".into(),
            face_glb: "test".into(),
            uniform_crc: 0,
            primitives: Vec::new(),
            embedded_textures: Vec::new(),
            skeleton: None,
            aux_textures: Vec::new(),
            report: serde_json::Value::Null,
            strict_materials: false,
            animation_clips: Vec::new(),
            animation_excluded: Vec::new(),
        };
        let glb = model.to_glb();
        assert!(glb.len() >= 12);
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);
        let total = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total, glb.len());
    }

    #[test]
    fn export_glb_avec_animations() {
        use crate::g4mt::{DecodedMotionClip, DecodedMotionKeyframe, DecodedMotionTrack};
        use crate::g4sk::LocalTrs;

        let default_trs = LocalTrs {
            scale: [1.0, 1.0, 1.0],
            quat: [0.0, 0.0, 0.0, 1.0],
            translation: [0.0, 0.0, 0.0],
        };

        let skeleton = Skeleton {
            source: "test.g4sk".into(),
            bones: vec![SkeletonBone {
                name: "root".into(),
                hash: 1,
                parent: None,
                local: default_trs,
                inverse_bind: [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                ],
            }],
        };

        let skin_data = PrimitiveSkin {
            joints: vec![[0; 8], [0; 8], [0; 8]],
            weights: vec![
                [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ],
        };

        let prim = MeshPrimitive {
            component: MeshComponent::Body,
            source_index: 0,
            positions: vec![
                crate::g4mg::Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                crate::g4mg::Vec3 {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                },
                crate::g4mg::Vec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
            ],
            normals: vec![
                crate::g4mg::Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
                crate::g4mg::Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
                crate::g4mg::Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
            ],
            uv0: vec![
                crate::g4mg::Vec2 { u: 0.0, v: 0.0 },
                crate::g4mg::Vec2 { u: 0.0, v: 1.0 },
                crate::g4mg::Vec2 { u: 1.0, v: 0.0 },
            ],
            colors: Vec::new(),
            indices: vec![0, 1, 2],
            material_index: 0,
            material_name: "mat".into(),
            texture_uri: String::new(),
            piece: "body".into(),
            skin: Some(skin_data),
        };

        let clip = DecodedMotionClip {
            name: "idle".into(),
            duration_seconds: 1.0,
            tracks: vec![DecodedMotionTrack {
                bone_index: 0,
                keyframes: vec![
                    DecodedMotionKeyframe {
                        time_seconds: 0.0,
                        pose: default_trs,
                    },
                    DecodedMotionKeyframe {
                        time_seconds: 1.0,
                        pose: LocalTrs {
                            translation: [0.0, 1.0, 0.0],
                            quat: [0.0, 0.0, 0.0, 1.0],
                            scale: [1.0, 1.0, 1.0],
                        },
                    },
                ],
            }],
        };

        let model = AssembledModel {
            internal_code: "test_anim".into(),
            body_glb: "base_normal_00".into(),
            face_glb: "test".into(),
            uniform_crc: 0,
            primitives: vec![prim],
            embedded_textures: Vec::new(),
            skeleton: Some(skeleton),
            aux_textures: Vec::new(),
            report: serde_json::Value::Null,
            strict_materials: false,
            animation_clips: vec![clip],
            animation_excluded: vec![AnimationExclusion {
                name: "additive_clip".into(),
                reason: "additif".into(),
            }],
        };

        let glb = model.to_glb_embedded();
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json: serde_json::Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();

        let anims = json["animations"]
            .as_array()
            .expect("animations glTF présentes");
        assert_eq!(anims.len(), 1);
        assert_eq!(anims[0]["name"], "idle");
        let channels = anims[0]["channels"].as_array().expect("channels présents");
        assert_eq!(channels.len(), 3);
        let extras = &json["extras"]["nie"]["animation"];
        assert_eq!(extras["included"], serde_json::json!(["idle"]));
        assert_eq!(extras["excluded"][0]["name"], "additive_clip");

        // La piste du clip translate sur deux images tout en gardant rotation et échelle fixes.
        // Les trois canaux restent présents — on ne perd rien — mais les deux constants ne
        // portent plus qu'UNE image clé, là où les émettre image par image multipliait le GLB
        // par plus de dix sur un vrai personnage (3,2 Mo → 44 Mo, mesuré le 2026-09-20).
        let counts: Vec<u64> = channels
            .iter()
            .map(|channel| {
                let sampler = &anims[0]["samplers"][channel["sampler"].as_u64().unwrap() as usize];
                let output = sampler["output"].as_u64().unwrap() as usize;
                json["accessors"][output]["count"].as_u64().unwrap()
            })
            .collect();
        let paths: Vec<&str> = channels
            .iter()
            .map(|channel| channel["target"]["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, ["translation", "rotation", "scale"]);
        assert_eq!(
            counts,
            [2, 1, 1],
            "seule la piste qui bouge garde ses deux images"
        );
    }

    // ── Tests des nouvelles fonctionnalités ───────────────────────────────────

    #[test]
    fn series_dir_from_code_couvre_toutes_series() {
        // Vérifiés sur l'index iev:file:index DB3 Redis (commun/chr/_face/).
        assert_eq!(series_dir_from_code("c01000010"), Some("01_ie1"));
        assert_eq!(series_dir_from_code("c02021010"), Some("02_ie2"));
        assert_eq!(series_dir_from_code("c03000010"), Some("03_ie3"));
        assert_eq!(series_dir_from_code("c04000420"), Some("04_go1"));
        assert_eq!(series_dir_from_code("c05000010"), Some("05_go2"));
        assert_eq!(series_dir_from_code("c06000010"), Some("06_go3"));
        assert_eq!(series_dir_from_code("c07030030"), Some("07_ares"));
        assert_eq!(series_dir_from_code("c08000010"), Some("08_orion"));
        assert_eq!(series_dir_from_code("c11000010"), Some("11_victory"));
        assert_eq!(series_dir_from_code("c20000010"), Some("20_edit"));
        assert_eq!(series_dir_from_code("c21000010"), Some("21_mannequin"));
        assert_eq!(series_dir_from_code("c22000010"), Some("22_combo"));
        // Codes inconnus / hors format.
        assert_eq!(series_dir_from_code("c99000010"), None);
        assert_eq!(series_dir_from_code("k000010"), None); // keshin
        assert_eq!(series_dir_from_code(""), None);
    }

    #[test]
    fn face_texture_uri_c01000010() {
        let cfg = TextureUriConfig::default();
        let uri = face_texture_uri("c01000010", &cfg).unwrap();
        // Chemin vérifié contre l'index iev:file:index DB3 :
        // data/dx11/chr/_face/01_ie1/c01000010/c01000010.g4tx
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_face/01_ie1/c01000010/c01000010.png"
        );
    }

    #[test]
    fn face_texture_uri_c02026080() {
        let cfg = TextureUriConfig::default();
        let uri = face_texture_uri("c02026080", &cfg).unwrap();
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_face/02_ie2/c02026080/c02026080.png"
        );
    }

    #[test]
    fn face_texture_uri_victory_road() {
        let cfg = TextureUriConfig::default();
        let uri = face_texture_uri("c11803060", &cfg).unwrap();
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_face/11_victory/c11803060/c11803060.png"
        );
    }

    #[test]
    fn face_texture_uri_keshin_none() {
        let cfg = TextureUriConfig::default();
        // Les keshins commencent par 'k' → pas de série → None.
        assert!(face_texture_uri("k000010", &cfg).is_none());
    }

    #[test]
    fn uniform_texture_uri_sk000901() {
        let cfg = TextureUriConfig::default();
        let uri = uniform_texture_uri("sk000901", &cfg);
        // Vérifié contre l'index : data/dx11/chr/_uniform/sk000901/sk000901_10.g4tx
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_uniform/sk000901/sk000901_10.png"
        );
    }

    #[test]
    fn uniform_texture_uri_u011001() {
        let cfg = TextureUriConfig::default();
        let uri = uniform_texture_uri("u011001", &cfg);
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_uniform/u011001/u011001_10.png"
        );
    }

    #[test]
    fn texture_uri_config_cdn_override() {
        let cfg = TextureUriConfig {
            cdn_base: "https://test.local".into(),
        };
        let uri = face_texture_uri("c01000010", &cfg).unwrap();
        assert!(uri.starts_with("https://test.local/dx11/"));
        let uri2 = uniform_texture_uri("sk000901", &cfg);
        assert!(uri2.starts_with("https://test.local/dx11/"));
    }

    #[test]
    fn manifest_load_et_resolve() {
        let ndjson = concat!(
            r#"{"crc":1717452463,"crc_hex":"0x665E3EAF","path":"data/common/chr/_face/01_ie1/c01000010/c01000010.g4md","cpk":"eaabb035.cpk"}"#,
            "\n",
            r#"{"crc":1717452463,"crc_hex":"0x665E3EAF","path":"data/common/chr/_face/01_ie1/c01000010/c01000010.g4mg","cpk":"eaabb035.cpk"}"#,
            "\n",
            r#"{"crc":2621281058,"path":"data/common/chr/_uniform/u011001/u011001.g4md","cpk":"abc.cpk"}"#,
        );
        let entries = load_manifest(ndjson);
        assert_eq!(entries.len(), 3);
        // Résolution CRC vers g4md
        let path = resolve_crc_to_g4md_path(&entries, 1717452463);
        assert_eq!(
            path,
            Some("data/common/chr/_face/01_ie1/c01000010/c01000010.g4md")
        );
        // g4md_to_g4mg_path
        let gmg = g4md_to_g4mg_path("data/common/chr/_face/01_ie1/c01000010/c01000010.g4md");
        assert_eq!(gmg, "data/common/chr/_face/01_ie1/c01000010/c01000010.g4mg");
        // CRC inconnu → None
        assert!(resolve_crc_to_g4md_path(&entries, 0xDEADBEEF).is_none());
    }

    #[test]
    fn manifest_ligne_malformee_ignoree() {
        let ndjson = "malformed\n{\"crc\":42,\"path\":\"x.g4md\",\"cpk\":\"y.cpk\"}\n";
        let entries = load_manifest(ndjson);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].crc, 42);
    }

    #[test]
    fn assemble_generic_vide_invalide_rejete() {
        // G4MD vide → FormatError::TooShort → AssembleError::Format
        let result = assemble_generic_model(GenericModelInput {
            code: "test".into(),
            g4md: vec![0u8; 4],
            g4mg: vec![],
            component: MeshComponent::Generic,
        });
        assert!(result.is_err(), "g4md invalide doit provoquer une erreur");
    }

    #[test]
    fn assemble_keshin_helper_component() {
        // Avec un g4md minimal invalide → erreur de format, mais le wrapper est bon.
        let result = assemble_keshin("k000010", vec![0u8; 4], vec![]);
        assert!(result.is_err()); // g4md trop court, mais le wrapper lui-même est correct
    }

    #[test]
    fn assemble_armed_helper_component() {
        let result = assemble_armed("ka001901", vec![0u8; 4], vec![]);
        assert!(result.is_err()); // g4md trop court
    }

    /// Teste to_glb_textured sur un modèle vide : doit produire un GLB valide
    /// sans section images/textures (pas de primitives avec texture_uri).
    #[test]
    fn glb_textured_modele_vide() {
        let mut model = AssembledModel {
            internal_code: "c01000010".into(),
            body_glb: String::new(),
            face_glb: String::new(),
            uniform_crc: 0,
            primitives: Vec::new(),
            embedded_textures: Vec::new(),
            skeleton: None,
            aux_textures: Vec::new(),
            report: serde_json::Value::Null,
            strict_materials: false,
            animation_clips: Vec::new(),
            animation_excluded: Vec::new(),
        };
        let cfg = TextureUriConfig::default();
        let glb = model.to_glb_textured(&cfg);
        assert!(glb.len() >= 12);
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67, "magic GLB textured");
        // Pas d'images (modèle vide) — JSON ne contient pas "images".
        // On vérifie juste la structure GLB (magic + total_len cohérent).
        let total = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total, glb.len());
    }

    #[test]
    fn glb_embarque_preserve_alpha_visage_et_masque_uniforme() {
        let model = AssembledModel {
            internal_code: "c01001900".into(),
            body_glb: "base_normal_00".into(),
            face_glb: "c01001900".into(),
            uniform_crc: 0,
            primitives: vec![
                primitive_test(MeshComponent::Face, "c01001900", &[0.0, 0.0, 1.0]),
                primitive_test(MeshComponent::Uniform, "u011001_10", &[0.0, 0.0, 1.0]),
            ],
            embedded_textures: vec![
                EmbeddedTexture {
                    component: MeshComponent::Face,
                    name: "c01001900".into(),
                    png_bytes: b"face-png".to_vec(),
                },
                EmbeddedTexture {
                    component: MeshComponent::Uniform,
                    name: "u011001_10".into(),
                    png_bytes: b"uniform-png".to_vec(),
                },
            ],
            skeleton: None,
            aux_textures: Vec::new(),
            report: serde_json::Value::Null,
            strict_materials: false,
            animation_clips: Vec::new(),
            animation_excluded: Vec::new(),
        };

        let glb = model.to_glb_embedded();
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json: serde_json::Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        let materials = json["materials"].as_array().unwrap();
        let face = materials.iter().find(|m| m["name"] == "c01001900").unwrap();
        let uniform = materials
            .iter()
            .find(|m| m["name"] == "u011001_10")
            .unwrap();

        assert_eq!(face["alphaMode"], "BLEND");
        assert!(face.get("alphaCutoff").is_none());
        assert_eq!(uniform["alphaMode"], "MASK");
        assert_eq!(uniform["alphaCutoff"], 0.5);
    }

    #[test]
    #[cfg(feature = "textures")]
    fn opaque_hair_texture_does_not_enter_transparent_render_queue() {
        let opaque = crate::g4tx_decode::encode_rgba_to_png(&[155, 154, 175, 255], 1, 1).unwrap();
        let transparent =
            crate::g4tx_decode::encode_rgba_to_png(&[155, 154, 175, 0], 1, 1).unwrap();
        assert_eq!(png_is_opaque(&opaque), Some(true));
        assert_eq!(png_is_opaque(&transparent), Some(false));
        assert_eq!(png_is_opaque(b"invalid"), None);
    }

    #[test]
    fn recalage_ne_remonte_pas_une_coiffure_longue_deja_alignee() {
        let body = vec![primitive_test(
            MeshComponent::Body,
            "",
            &[1.291, 1.599, 1.45],
        )];
        let mut face = vec![primitive_test(
            MeshComponent::Face,
            "c01001900",
            &[0.894, 1.30, 1.645],
        )];

        recaler_face_flotante(&body, &mut face);

        assert_eq!(face[0].positions[0].y, 0.894);
        assert_eq!(face[0].positions[2].y, 1.645);
    }

    #[test]
    fn recalage_redescend_une_face_entierement_trop_haute() {
        let body = vec![primitive_test(
            MeshComponent::Body,
            "",
            &[1.291, 1.599, 1.45],
        )];
        let mut face = vec![primitive_test(
            MeshComponent::Face,
            "flottante",
            &[1.741, 1.80, 2.10],
        )];

        recaler_face_flotante(&body, &mut face);

        assert!((face[0].positions[0].y - 1.291).abs() < 1e-5);
        assert!((face[0].positions[2].y - 1.65).abs() < 1e-5);
    }

    /// Test d'intégration : assemblage de c01000010 avec textures URI CDN.
    ///
    /// Vérifie que to_glb_textured injecte les images[] dans le JSON glTF quand
    /// les primitives face ont une texture_uri renseignée.
    #[test]
    fn assemblage_c01000010_avec_textures_uri() {
        if !glb_dir().exists() {
            eprintln!("SKIP : répertoire GLB absent");
            return;
        }
        if !glb_dir().join("c01000010.glb").exists()
            || !glb_dir().join("base_normal_00.glb").exists()
        {
            eprintln!("SKIP : GLBs manquants");
            return;
        }

        let input = CharacterAssemblyInput {
            internal_code: "c01000010".into(),
            body_type_idx: 0,
            glb_dir: glb_dir(),
            uniform_model_crc: 0,
            uniform_g4md: None,
            uniform_g4mg: None,
            uniform_glb_path: None,
            uniform_parts: Vec::new(),
            body_raw: None,
            face_raw: None,
            skeleton: None,
        };

        let mut model = assemble_character_model(&input).expect("assemblage c01000010");
        let cfg = TextureUriConfig::default();

        // Avant resolve : toutes les texture_uri sont vides (GLBs pré-convertis).
        // Les GLBs pré-convertis ont material_name = "" (pas de G4MD source).
        let all_empty = model.primitives.iter().all(|p| p.texture_uri.is_empty());
        assert!(all_empty, "texture_uri vides avant resolve");

        // Appel de to_glb_textured.
        let glb_textured = model.to_glb_textured(&cfg);
        assert!(glb_textured.len() >= 12, "GLB textured non vide");

        // Vérification magic.
        let magic = u32::from_le_bytes([
            glb_textured[0],
            glb_textured[1],
            glb_textured[2],
            glb_textured[3],
        ]);
        assert_eq!(magic, 0x46546C67, "magic GLB textured valide");

        // Le JSON doit contenir au moins les materials.
        // On extrait le JSON du GLB pour vérification.
        let json_len = u32::from_le_bytes([
            glb_textured[12],
            glb_textured[13],
            glb_textured[14],
            glb_textured[15],
        ]) as usize;
        assert!(
            json_len > 0 && 20 + json_len <= glb_textured.len(),
            "chunk JSON valide"
        );
        let json_bytes = &glb_textured[20..20 + json_len];
        let json_str = std::str::from_utf8(json_bytes)
            .unwrap()
            .trim_end_matches('\0')
            .trim();
        let json_val: serde_json::Value = serde_json::from_str(json_str).expect("JSON glTF valide");
        assert!(json_val["materials"].is_array(), "materials présents");
        // Pour c01000010 depuis GLBs pré-convertis : pas de material_name → pas d'images URI.
        // Un seul matériau Default attendu.
        let mats = json_val["materials"].as_array().unwrap();
        assert!(!mats.is_empty(), "au moins 1 matériau");

        eprintln!(
            "PASS textured c01000010 : {}B GLB, {} matériaux",
            glb_textured.len(),
            mats.len()
        );
    }

    /// Test d'intégration : assemble_generic_model avec un vrai G4MD+G4MG de keshin
    /// (k000010 — premier keshin réel). Skip si les CPK ne sont pas disponibles.
    #[test]
    fn assemble_keshin_k000010_depuis_cpk() {
        use crate::vfs::Vfs;

        let game_data = crate::vfs::resolve_game_dir().join("data");
        let mut vfs = Vfs::new();
        if vfs.init(&game_data).is_err() {
            eprintln!("SKIP : VFS non initialisable (game_data absent)");
            return;
        }

        // Chemin vérifié dans le manifeste : data/common/chr/_keshin/k000010/k000010.g4md
        let g4md_path = "data/common/chr/_keshin/k000010/k000010.g4md";
        let g4mg_path = "data/common/chr/_keshin/k000010/k000010.g4mg";

        let g4md_data = match vfs.read(g4md_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("SKIP : G4MD keshin k000010 non lisible : {e}");
                return;
            }
        };
        let g4mg_data = match vfs.read(g4mg_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("SKIP : G4MG keshin k000010 non lisible : {e}");
                return;
            }
        };

        let model =
            assemble_keshin("k000010", g4md_data, g4mg_data).expect("assemblage keshin k000010");

        assert!(
            !model.primitives.is_empty(),
            "keshin k000010 a des primitives"
        );
        assert!(
            model.total_vertex_count() > 0,
            "keshin k000010 a des vertices"
        );
        assert_eq!(model.primitives[0].component, MeshComponent::Keshin);
        assert_eq!(model.internal_code, "k000010");

        let glb = model.to_glb();
        assert!(glb.len() > 12, "GLB keshin non vide");
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);

        eprintln!(
            "PASS keshin k000010 : {}v / {}tri, glb={}B",
            model.total_vertex_count(),
            model.total_triangle_count(),
            glb.len()
        );
    }

    /// Test d'intégration : assemble_armed avec une vraie armure (ka001901).
    #[test]
    fn assemble_armd_ka001901_depuis_cpk() {
        use crate::vfs::Vfs;

        let game_data = crate::vfs::resolve_game_dir().join("data");
        let mut vfs = Vfs::new();
        if vfs.init(&game_data).is_err() {
            eprintln!("SKIP : VFS non initialisable");
            return;
        }

        // Chemin vérifié dans le manifeste NDJSON : data/common/chr/_armd/ka001901/ka001906.g4md
        // Le répertoire contient plusieurs variants : ka001901..ka001906
        // On utilise la première entrée du répertoire (ka001901).
        let g4md_path = "data/common/chr/_armd/ka001901/ka001901.g4md";
        let g4mg_path = "data/common/chr/_armd/ka001901/ka001901.g4mg";

        let g4md_data = match vfs.read(g4md_path) {
            Ok(d) => d,
            Err(_) => {
                // Essaie le variant ka001906
                match vfs.read("data/common/chr/_armd/ka001901/ka001906.g4md") {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("SKIP : G4MD armd ka001901 non lisible : {e}");
                        return;
                    }
                }
            }
        };
        let g4mg_path_actual = if vfs.find(g4mg_path).is_some() {
            g4mg_path
        } else {
            "data/common/chr/_armd/ka001901/ka001906.g4mg"
        };
        let g4mg_data = match vfs.read(g4mg_path_actual) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("SKIP : G4MG armd non lisible : {e}");
                return;
            }
        };

        let model =
            assemble_armed("ka001901", g4md_data, g4mg_data).expect("assemblage armd ka001901");

        assert!(
            !model.primitives.is_empty(),
            "armure ka001901 a des primitives"
        );
        assert!(model.total_vertex_count() > 0, "armure a des vertices");
        assert_eq!(model.primitives[0].component, MeshComponent::Armed);

        let glb = model.to_glb();
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);

        eprintln!(
            "PASS armd ka001901 : {}v / {}tri, glb={}B",
            model.total_vertex_count(),
            model.total_triangle_count(),
            glb.len()
        );
    }

    /// Test d'intégration : assemble uniforme depuis CPK via VFS + manifeste.
    /// Vérifie le chemin complet CRC → g4md_path → VFS → G4MD+G4MG → primitives.
    #[test]
    fn chaque_morphologie_recoit_un_corps_de_son_squelette() {
        // Les deux contraintes doivent se recouper : le corps affecté à une morphologie doit
        // appartenir à la paire que le squelette de cette morphologie autorise. Si l'une des deux
        // tables bouge sans l'autre, ce test le dit.
        let par_squelette = [
            ("c000101_edit", ["male", "female"]),
            ("c000201_edit", ["small", "smallfat"]),
            ("c000301_edit", ["tall", "tallmuscle"]),
            ("c000401_edit", ["muscle", "big"]),
        ];
        for (squelette, morphos) in par_squelette {
            let autorises = avatar_bodies_for_skeleton(squelette);
            assert_eq!(autorises.len(), 2, "{squelette} doit avoir deux corps");
            let mut vus = Vec::new();
            for m in morphos {
                let corps = avatar_body_for_morphology(m)
                    .unwrap_or_else(|| panic!("morphologie {m} sans corps"));
                assert!(
                    autorises.contains(&corps),
                    "{m} reçoit {corps}, qui n'appartient pas au squelette {squelette}"
                );
                vus.push(corps);
            }
            assert_ne!(
                vus[0], vus[1],
                "{squelette} : deux morphologies ne peuvent partager un corps"
            );
        }
    }

    #[test]
    fn chaque_corps_epouse_son_squelette() {
        use crate::vfs::Vfs;

        let racine = crate::vfs::resolve_game_dir();
        let mut vfs = Vfs::new();
        if vfs.init(racine.join("data")).is_err() {
            eprintln!("SKIP : VFS non initialisable");
            return;
        }

        // Une tête de référence, attachée puis mesurée : c'est son bas qui doit rejoindre le haut
        // du corps. N'importe quelle tête ferait l'affaire, celle-ci est la plus courante.
        let tete = "data/common/chr/_face/20_EDIT/_facebase/face51_nose01";
        let (Ok(tete_md), Ok(tete_mg)) = (
            vfs.read(&format!("{tete}.g4md")),
            vfs.read(&format!("{tete}.g4mg")),
        ) else {
            eprintln!("SKIP : tête de référence illisible");
            return;
        };

        let mut verifies = 0;
        for squelette in [
            "c000101_edit",
            "c000201_edit",
            "c000301_edit",
            "c000401_edit",
        ] {
            let chemin_sk =
                format!("data/common/chr/_face/20_EDIT/_bodySK/{squelette}/{squelette}.g4sk");
            let Ok(g4sk) = vfs.read(&chemin_sk) else {
                eprintln!("SKIP : squelette {squelette} illisible");
                continue;
            };
            let Some(attache) = bone_rest_world(&g4sk, "c_head_1_0") else {
                panic!("{squelette} : l'os c_head_1_0 doit exister");
            };

            // Bas de la tête, une fois attachée.
            let tete_assemblee = assemble_avatar_model(
                "t",
                &[AvatarPiece {
                    component: MeshComponent::Face,
                    g4md: tete_md.clone(),
                    g4mg: tete_mg.clone(),
                    attach: Some(attache),
                }],
            )
            .expect("assemblage de la tête");
            let tete_bas = tete_assemblee
                .primitives
                .iter()
                .flat_map(|p| p.positions.iter())
                .fold(f32::INFINITY, |acc, v| acc.min(v.y));

            for corps in avatar_bodies_for_skeleton(squelette) {
                let base = format!("data/common/chr/_uniform/{AVATAR_BODY_DIR}/{corps}");
                let (Ok(md), Ok(mg)) = (
                    vfs.read(&format!("{base}.g4md")),
                    vfs.read(&format!("{base}.g4mg")),
                ) else {
                    eprintln!("SKIP : corps {corps} illisible");
                    continue;
                };
                let assemble = assemble_avatar_model(
                    "c",
                    &[AvatarPiece {
                        component: MeshComponent::Uniform,
                        g4md: md,
                        g4mg: mg,
                        attach: None,
                    }],
                )
                .expect("assemblage du corps");
                let corps_haut = assemble
                    .primitives
                    .iter()
                    .flat_map(|p| p.positions.iter())
                    .fold(f32::NEG_INFINITY, |acc, v| acc.max(v.y));

                let ecart = (corps_haut - tete_bas).abs();
                // Les 32 combinaisons mesurées séparent nettement : au plus 33 mm quand le corps
                // va avec le squelette, au moins 194 mm sinon. 50 mm tranche sans être fragile.
                assert!(
                    ecart < 0.05,
                    "{squelette} + {corps} : écart {ecart:.3} m entre le haut du corps \
                     ({corps_haut:.3}) et le bas de la tête ({tete_bas:.3})"
                );
                verifies += 1;
            }
        }
        assert!(
            verifies > 0,
            "aucune paire vérifiée — le corpus est-il présent ?"
        );
        eprintln!("{verifies} paire(s) corps/squelette vérifiée(s)");
    }

    #[test]
    fn assemble_uniforme_depuis_cpk_via_manifeste() {
        use crate::vfs::Vfs;

        let racine = crate::vfs::resolve_game_dir();
        let game_data = racine.join("data");
        // `var/` appartient au dépôt, pas à l'installation du jeu : le manifeste
        // était cherché sous la racine du jeu, où il ne peut pas exister.
        let depot = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .expect("racine du dépôt");
        let manifest_path = depot.join("var/model-crc-manifest.ndjson");

        // Charger le manifeste.
        let manifest_str = match std::fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => {
                eprintln!("SKIP : manifeste {} absent", manifest_path.display());
                return;
            }
        };
        let manifest = load_manifest(&manifest_str);
        assert!(!manifest.is_empty(), "manifeste non vide");

        // CRC du g4md Raimon IE1 fielder (u011001.g4md), vérifié dans le manifeste NDJSON :
        // {"crc":2795242763,"crc_hex":"0xA69C050B","path":"data/common/chr/_uniform/u011001/u011001.g4md",...}
        // Note : 0x9D2BBD10 est le CRC *modelId* dans inagle_uniforms (espace différent).
        let raimon_fielder_crc: u32 = 0xA69C050B;
        let g4md_path_opt = resolve_crc_to_g4md_path(&manifest, raimon_fielder_crc);

        let g4md_path = match g4md_path_opt {
            Some(p) => p,
            None => {
                eprintln!(
                    "SKIP : CRC Raimon fielder {:#010x} absent du manifeste",
                    raimon_fielder_crc
                );
                return;
            }
        };

        let g4mg_path = g4md_to_g4mg_path(g4md_path);
        eprintln!("Uniforme Raimon fielder : {g4md_path}");

        let mut vfs = Vfs::new();
        if vfs.init(game_data).is_err() {
            eprintln!("SKIP : VFS non initialisable");
            return;
        }

        let g4md_data = match vfs.read(g4md_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("SKIP : G4MD uniforme non lisible : {e}");
                return;
            }
        };
        let g4mg_data = match vfs.read(&g4mg_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("SKIP : G4MG uniforme non lisible : {e}");
                return;
            }
        };

        let model = assemble_generic_model(GenericModelInput {
            code: "raimon_ie1_fielder".into(),
            g4md: g4md_data,
            g4mg: g4mg_data,
            component: MeshComponent::Uniform,
        })
        .expect("assemblage uniforme Raimon IE1");

        assert!(
            !model.primitives.is_empty(),
            "uniforme Raimon a des primitives"
        );
        assert!(model.total_vertex_count() > 0, "uniforme a des vertices");
        assert_eq!(model.primitives[0].component, MeshComponent::Uniform);

        // Vérifie que material_name est renseigné (depuis G4MD material_base_names).
        let has_mat_name = model.primitives.iter().any(|p| !p.material_name.is_empty());
        // Non obligatoire si G4MD a 0 materials, mais habituel pour les uniformes.
        // On le note sans assert bloquant.
        eprintln!(
            "PASS uniforme Raimon IE1 : {}v / {}tri, mat_name={}",
            model.total_vertex_count(),
            model.total_triangle_count(),
            has_mat_name
        );

        let glb = model.to_glb();
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);
    }
    /// Fabrique une primitive dont la boîte englobante et le compte de triangles sont imposés.
    fn prim_test(mn: [f32; 3], mx: [f32; 3], triangles: usize) -> MeshPrimitive {
        let coin = |v: [f32; 3]| g4mg::Vec3 {
            x: v[0],
            y: v[1],
            z: v[2],
        };
        MeshPrimitive {
            component: MeshComponent::Uniform,
            source_index: 0,
            material_index: 0,
            material_name: String::new(),
            texture_uri: String::new(),
            positions: vec![coin(mn), coin(mx)],
            normals: Vec::new(),
            uv0: Vec::new(),
            colors: Vec::new(),
            indices: vec![0; triangles * 3],
            skin: None,
            piece: String::new(),
        }
    }

    #[test]
    fn niveaux_de_detail_empiles_reduits_au_plus_fin() {
        // Les trois emprises relevées sur `u000101` : haut du corps, bas du corps, chaussures —
        // chacune en trois niveaux consécutifs de finesse décroissante.
        let prims = vec![
            prim_test([-0.326, 0.895, -0.091], [0.326, 1.264, 0.122], 778),
            prim_test([-0.326, 0.895, -0.089], [0.326, 1.264, 0.122], 404),
            prim_test([-0.326, 0.895, -0.089], [0.326, 1.264, 0.122], 298),
            prim_test([-0.186, 0.088, -0.107], [0.186, 0.895, 0.117], 802),
            prim_test([-0.186, 0.088, -0.107], [0.186, 0.895, 0.117], 400),
            prim_test([-0.186, 0.088, -0.107], [0.186, 0.895, 0.117], 314),
        ];
        let gardees = retenir_niveau_detail_max(prims);
        let comptes: Vec<usize> = gardees.iter().map(MeshPrimitive::triangle_count).collect();
        assert_eq!(comptes, vec![778, 802], "un seul niveau par emprise");
    }

    #[test]
    fn pieces_de_boites_distinctes_toutes_conservees() {
        // Le visage : visage, yeux et bouche ont des emprises différentes — aucune n'est un
        // niveau de détail d'une autre, et le filtre ne doit en retirer aucune.
        let prims = vec![
            prim_test([-0.123, 1.293, -0.139], [0.123, 1.595, 0.135], 2748),
            prim_test([-0.116, 1.362, 0.029], [0.116, 1.579, 0.122], 752),
            prim_test([-0.102, 1.293, 0.036], [0.102, 1.377, 0.122], 320),
        ];
        assert_eq!(retenir_niveau_detail_max(prims).len(), 3);
    }
}

/// Tests sur les fichiers RÉELS de Byron Love / Aphrody (`c01001900`, squelette `c000101`),
/// lus dans le dump du jeu (`<racine>/data/common/chr/...`). Sautés si le dump est absent.
#[cfg(test)]
mod tests_byron {
    use super::*;

    /// VFS monté une seule fois : `Vfs::init` indexe tous les CPK du jeu, ce qui
    /// est trop coûteux pour être refait à chaque lecture.
    fn vfs_partage() -> Option<&'static crate::vfs::Vfs> {
        use std::sync::OnceLock;
        static VFS: OnceLock<Option<crate::vfs::Vfs>> = OnceLock::new();
        VFS.get_or_init(|| {
            let mut vfs = crate::vfs::Vfs::new();
            match vfs.init(crate::vfs::resolve_game_dir().join("data")) {
                Ok(()) => Some(vfs),
                Err(e) => {
                    eprintln!("SKIP : VFS non initialisable : {e}");
                    None
                }
            }
        })
        .as_ref()
    }

    /// Lit un fichier sous `data/common/chr/`.
    ///
    /// Une installation réelle ne garde en vrac que `data/common/system` : tout le
    /// reste vit dans les CPK. Ces tests lisaient directement le disque et
    /// sautaient donc systématiquement — la lecture passe par le VFS, le dump en
    /// vrac ne servant plus que de repli.
    fn chr(rel: &str) -> Option<Vec<u8>> {
        let interne = alloc::format!("data/common/chr/{}", rel.replace('\\', "/"));
        if let Some(vfs) = vfs_partage() {
            match vfs.read(&interne) {
                Ok(d) => return Some(d),
                Err(e) => eprintln!("VFS : {interne} illisible ({e}) — repli sur le dump en vrac"),
            }
        }
        let p = crate::vfs::resolve_game_dir()
            .join("data/common/chr")
            .join(rel);
        match std::fs::read(&p) {
            Ok(d) => Some(d),
            Err(_) => {
                eprintln!("SKIP : {interne} absent du VFS et {} absent", p.display());
                None
            }
        }
    }

    fn raw(name: &str, rel: &str) -> Option<RawPiece> {
        let g4md_path = format!("{rel}/{name}.g4md");
        Some(RawPiece {
            name: name.into(),
            g4md_path: format!("data/common/chr/{g4md_path}"),
            g4md: chr(&g4md_path)?,
            g4mg: chr(&format!("{rel}/{name}.g4mg"))?,
        })
    }

    #[test]
    fn g4md_de_byron_expose_palettes_layouts_et_materiaux_reels() {
        let Some(data) = chr("_face/01_IE1/c01001900/c01001900.g4md") else {
            return;
        };
        let md = g4md::parse(&data).expect("parse c01001900.g4md");
        assert_eq!(md.submeshes.len(), 3);
        assert_eq!(md.header.bone_count, 98);
        assert_eq!(md.joint_hashes.len(), 98);
        assert_eq!(md.joint_hashes[0], crate::cfgbin::crc32(b"output"));
        assert_eq!(md.layouts.len(), 3, "trois layouts vertex déclarés");
        let slots: Vec<u8> = md.submeshes.iter().map(|s| s.material_slot).collect();
        assert_eq!(slots, vec![2, 0, 1], "chevelure, œil, bouche");
        assert!(md.material_slots_plausible());
        let pal: Vec<u8> = md.submeshes.iter().map(|s| s.palette_len).collect();
        assert_eq!(pal, vec![15, 1, 1]);
        assert_eq!(md.submeshes[0].palette_offset, 1);
        assert_eq!(md.palette_of(&md.submeshes[0]).len(), 15);
        assert_eq!(md.palette_of(&md.submeshes[1]), &[29]);
        assert!(md.submeshes.iter().all(|s| s.vertex_stride == 68));
        assert_eq!(md.submeshes[0].triangle_count, 1509);
        let layouts: Vec<u8> = md.submeshes.iter().map(|s| s.layout_index).collect();
        assert_eq!(layouts, vec![2, 0, 1]);
        // Le layout propre porte bien poids (5) et indices (6) d'os.
        assert!(md.find_attribute_of(&md.submeshes[0], 5).is_some());
        assert!(md.find_attribute_of(&md.submeshes[0], 6).is_some());
    }

    #[test]
    fn squelette_c000101_est_coherent_avec_ses_matrices_inverse_bind() {
        let Some(data) = chr("c000101/c000101.g4sk") else {
            return;
        };
        let sk = Skeleton::from_g4sk("c000101.g4sk", &data).expect("squelette");
        assert_eq!(sk.bones.len(), 165);
        assert_eq!(sk.bones[0].name, "output");
        assert!(sk.bone_by_name("c_head_1_0").is_some());
        assert!(
            sk.bone_by_hash(crate::cfgbin::crc32(b"c_head_1_0"))
                .is_some()
        );
        let err = sk.bind_consistency_error();
        assert!(err < 1e-3, "monde·inverse_bind loin de l'identité : {err}");
    }

    #[test]
    fn le_visage_de_byron_est_skinne_sur_la_tete_et_ses_materiaux_sont_les_bons() {
        let (Some(face), Some(skdata)) = (
            raw("c01001900", "_face/01_IE1/c01001900"),
            chr("c000101/c000101.g4sk"),
        ) else {
            return;
        };
        let sk = Skeleton::from_g4sk("c000101.g4sk", &skdata).unwrap();
        let (prims, ex) = extract_piece(
            &face.g4md,
            &face.g4mg,
            MeshComponent::Face,
            "c01001900",
            Some(&sk),
        )
        .unwrap();
        let mats: Vec<&str> = prims.iter().map(|p| p.material_name.as_str()).collect();
        assert_eq!(mats, vec!["c01001900_20", "eye_10", "mouth_10"]);
        assert!(ex.material_slots_from_file);
        assert_eq!(ex.skin.skinned_submeshes, 3);
        assert_eq!(ex.skin.static_submeshes, 0);
        assert!(
            ex.skin.unresolved_hashes.is_empty(),
            "{:x?}",
            ex.skin.unresolved_hashes
        );
        assert_eq!(ex.skin.vertices_without_bone, 0);
        let head = sk.bone_by_name("c_head_1_0").unwrap() as u16;
        assert!(ex.skin.bones_used.contains(&head));
        // Yeux et bouche : un seul os, la tête.
        for p in &prims[1..] {
            assert_eq!(p.skin.as_ref().unwrap().bones_used(), vec![head]);
        }
        // Chaque vertex skinné a des poids qui somment à 1.
        for p in &prims {
            for w in &p.skin.as_ref().unwrap().weights {
                let s: f32 = w.iter().sum();
                assert!((s - 1.0).abs() < 1e-3, "somme {s}");
            }
        }
    }

    #[test]
    fn byron_complet_est_assemble_skinne_et_exporte_avec_un_skin_glb() {
        let (Some(body), Some(face), Some(skin_part), Some(shoes), Some(skdata)) = (
            raw("base_normal_00", "_face/20_EDIT/_base"),
            raw("c01001900", "_face/01_IE1/c01001900"),
            raw("sk000101", "_uniform/sk000101"),
            raw("s011001", "_uniform/s011001"),
            chr("c000101/c000101.g4sk"),
        ) else {
            return;
        };
        let input = CharacterAssemblyInput {
            internal_code: "c01001900".into(),
            body_type_idx: 0,
            glb_dir: PathBuf::new(),
            uniform_model_crc: 0xF000_6501,
            uniform_g4md: None,
            uniform_g4mg: None,
            uniform_glb_path: None,
            uniform_parts: vec![
                CharacterUniformPart {
                    role: "skin".into(),
                    raw: skin_part,
                },
                CharacterUniformPart {
                    role: "shoes".into(),
                    raw: shoes,
                },
            ],
            body_raw: Some(body),
            face_raw: Some(face),
            skeleton: Some(Skeleton::from_g4sk("c000101.g4sk", &skdata).unwrap()),
        };
        let model = assemble_character_model(&input).expect("assemblage Byron");
        assert_eq!(model.report["mode"], "skinned");
        // Les niveaux de détail grossiers sont écartés par leur nom, positionnel dans la table :
        // la peau garde sa maille pleine (1049 sommets), pas `sk000101_10_LOD` (728).
        let peau = model
            .primitives
            .iter()
            .filter(|p| p.piece == "sk000101")
            .map(MeshPrimitive::vertex_count)
            .collect::<Vec<_>>();
        assert_eq!(peau, vec![1049]);
        assert!(model.skeleton.is_some());
        assert_eq!(model.report["face_recalee"], false);
        let pieces = model.report["pieces"].as_array().unwrap();
        assert_eq!(pieces.len(), 4);
        for p in pieces {
            assert_eq!(p["origin"], "vfs", "{p}");
            assert_eq!(p["skin"]["vertices_without_bone"], 0, "{p}");
            assert!(
                p["skin"]["unresolved_hashes"]
                    .as_array()
                    .unwrap()
                    .is_empty(),
                "{p}"
            );
        }
        // Les bornes restent celles d'un personnage debout : ~1,65 m de haut.
        let (lo, hi) = bornes(&model.primitives).unwrap();
        assert!(lo[1] > -0.05 && hi[1] < 1.8, "y ∈ [{}, {}]", lo[1], hi[1]);

        let glb = model.to_glb_embedded();
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json: serde_json::Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        let skins = json["skins"].as_array().expect("skins présents");
        assert_eq!(skins[0]["joints"].as_array().unwrap().len(), 165);
        let nodes = json["nodes"].as_array().unwrap();
        for mesh in json["meshes"].as_array().unwrap() {
            for prim in mesh["primitives"].as_array().unwrap() {
                assert!(
                    !prim["attributes"]["JOINTS_0"].is_null(),
                    "{}",
                    mesh["name"]
                );
                assert!(!prim["attributes"]["WEIGHTS_0"].is_null());
            }
        }
        let skinned_nodes = nodes.iter().filter(|n| !n["mesh"].is_null()).count();
        assert_eq!(skinned_nodes, 3, "Body, Face, Uniform");
        assert!(
            nodes
                .iter()
                .filter(|n| !n["mesh"].is_null())
                .all(|n| n["skin"] == 0)
        );
        assert!(nodes.iter().any(|n| n["name"] == "c_head_1_0"));
    }
}

/// Le haut de la tenue Zeus (`u011001`) : niveaux de détail et UV du short, sur le fichier réel.
#[cfg(test)]
mod tests_uniforme_zeus {
    use super::*;

    /// Lit un fichier sous `data/common/chr/` via le VFS : une installation réelle
    /// ne garde en vrac que `data/common/system`, tout le reste est en CPK.
    fn chr(rel: &str) -> Option<Vec<u8>> {
        use std::sync::OnceLock;
        static VFS: OnceLock<Option<crate::vfs::Vfs>> = OnceLock::new();
        let vfs = VFS
            .get_or_init(|| {
                let mut vfs = crate::vfs::Vfs::new();
                match vfs.init(crate::vfs::resolve_game_dir().join("data")) {
                    Ok(()) => Some(vfs),
                    Err(e) => {
                        eprintln!("SKIP : VFS non initialisable : {e}");
                        None
                    }
                }
            })
            .as_ref()?;
        let interne = alloc::format!("data/common/chr/{rel}");
        match vfs.read(&interne) {
            Ok(d) => Some(d),
            Err(e) => {
                eprintln!("SKIP : {interne} illisible ({e})");
                None
            }
        }
    }

    #[test]
    fn le_haut_garde_ses_mailles_pleines_et_les_uv_du_short_couvrent_la_planche() {
        // Les uniformes vivent dans les CPK, pas en vrac sur le disque.
        let (Some(g4md), Some(g4mg)) = (
            chr("_uniform/u011001/u011001.g4md"),
            chr("_uniform/u011001/u011001.g4mg"),
        ) else {
            return;
        };
        let md = g4md::parse(&g4md).unwrap();
        assert_eq!(
            md.mesh_names,
            vec![
                "u011001_20",
                "u011001_20_LOD1",
                "u011001_20_LOD2",
                "u011001_30",
                "u011001_30_LOD1",
                "u011001_30_LOD2"
            ]
        );
        assert_eq!(md.material_base_names, vec!["u011001_20", "u011001_30"]);
        let (prims, ex) =
            extract_piece(&g4md, &g4mg, MeshComponent::Uniform, "u011001", None).unwrap();
        assert_eq!(ex.lod_dropped_by_name, 4);
        let comptes: Vec<(String, usize)> = prims
            .iter()
            .map(|p| (p.material_name.clone(), p.vertex_count()))
            .collect();
        assert_eq!(
            comptes,
            vec![
                ("u011001_20".to_string(), 1178),
                ("u011001_30".to_string(), 668)
            ]
        );
        // Le short (layout 1, UV float à +0x40, stride 72) parcourt toute la planche en V ; lu en
        // ushort, il restait dans [0,237 ; 0,248].
        let short = &prims[1];
        let v_min = short.uv0.iter().map(|t| t.v).fold(f32::INFINITY, f32::min);
        let v_max = short
            .uv0
            .iter()
            .map(|t| t.v)
            .fold(f32::NEG_INFINITY, f32::max);
        assert!(v_max - v_min > 0.3, "V ∈ [{v_min}, {v_max}]");
        assert!((short.uv0[0].u - 0.8898).abs() < 1e-3 && (short.uv0[0].v - 0.2971).abs() < 1e-3);
    }
}
