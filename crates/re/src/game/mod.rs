// SPDX-License-Identifier: Apache-2.0
//! Game RE engine (Apache-2.0):
//! AOB signature scanning, live process-memory inspection, the DBXV2 binary format
//! parsers (BAC/BDM/CMS/CUS/EMB/EMD/EMM/ESK/MSG/PUP/SAV), the Dragon Ball game
//! catalog, Steam install inspection, text extraction and the unified state; plus the
//! game-agnostic asset pipeline ([`assets`], feature `assets`) that mounts, indexes and
//! exports any installed game (CPK through the canonical `aphrody-nie-formats` readers).
#[cfg(any(feature = "wasm", feature = "dbxv2"))]
pub mod api;
#[cfg(feature = "assets")]
pub mod assets;
pub mod catalog;
pub mod convert;
/// Export a DBXV2 `.emd` object to GLB so it renders through the nie 3D pipeline.
#[cfg(feature = "dbxv2")]
pub mod emd_gltf;
pub mod error;
pub mod formats;
pub mod fs;
pub mod gameplay;
#[cfg(feature = "dbxv2")]
pub mod index;
pub mod inventory;
pub mod live;
pub mod reverse;
/// Engine-facing asset runtime: streams and format-decodes assets from the merged games.
#[cfg(feature = "assets")]
pub mod runtime;
pub mod steam;
pub mod text;
pub mod unified;
/// Streamed mount of several game installs under one `<game>/<path>` namespace.
#[cfg(feature = "assets")]
pub mod unified_vfs;
pub mod world;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use catalog::{
    CANON_STATUS_DERIVED_GAME, DetectedGame, DragonBallGame, GameEngine, Platform, SaveLocation,
    filter_by_engine, filter_by_platform, find_game_by_android_package, find_game_by_id,
    find_game_by_steam_app_id, get_dragon_ball_catalog, scan_all_installed_games,
    scan_installed_android_packages, scan_installed_steam_games, search_catalog,
};
pub use error::{ReError, Result};
pub use formats::{
    bac::{BacFile, BacHitbox, BacMove},
    bdm::{BdmEntry, BdmFile, DamageType},
    cms::{CmsEntry, CmsFile},
    cus::{CusFile, CusSkill, SkillCategory},
    emb::{EmbFile, EmbRgbaTexture, EmbTextureEntry, TexturePixelFormat},
    emd::{EmdFile, EmdMesh, EmdModelPart, EmdSubmesh, EmdVertex},
    emm::{EmmFile, EmmMaterial, EmmParameter},
    esk::{EskBone, EskFile, standard_dbxv2_skeleton},
    model_assemble::{AssembledCharacterModel, ModelPrimitive},
    moveset::{CharacterMoveset, MoveFrameData},
    msg::{MsgEntry, MsgFile},
    pup::{PupEntry, PupFile},
    sav::{Dxbv2Cac, Dxbv2Save},
};
pub use live::aob::AobPattern;
pub use steam::{
    Dbxv2Install, STEAM_APP_ID_DB_FIGHTERZ, STEAM_APP_ID_DB_KAKAROT, STEAM_APP_ID_DB_SPARKING_ZERO,
    STEAM_APP_ID_DBXV1, STEAM_APP_ID_DBXV2, SteamGameInstall, inspect_dbxv2_install,
    scan_dragon_ball_installs,
};
pub use unified::{
    BinaryFunctionEntry, BinaryReOverview, Dbxv2UnifiedState, LiveWineOverview, ResolvedSkill,
    SaveOverview, UnifiedCharacterProfile,
};
pub use world::xenoverse3::{Xenoverse3Map, xenoverse3_prototype_map};
