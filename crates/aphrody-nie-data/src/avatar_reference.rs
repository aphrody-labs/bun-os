//! Import contracts for Chara Edit projects and external player references.
//!
//! A local NIE project contains complete editable state and can be validated by the resolver.
//! Zukan and Azalee player links only identify a canonical player, so they remain reference-only:
//! no measured table maps those players to editable Chara Edit recipes. The game's share code
//! can be decoded to raw slots, but those slots are never guessed into `faceSettingType` values.

use alloc::{boxed::Box, string::String, vec::Vec};
use core::fmt;

use crate::avatar::AvatarState;
#[cfg(feature = "serde")]
use crate::avatar::{AvatarCatalog, resolve_avatar};
#[cfg(feature = "serde")]
use alloc::string::ToString;

/// One slot in the game's exported avatar share-code description.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarShareSlot {
    pub bits: usize,
    #[cfg_attr(feature = "serde", serde(rename = "emplacement"))]
    pub slot: usize,
    #[cfg_attr(feature = "serde", serde(rename = "valeurs"))]
    pub values: usize,
    #[cfg_attr(feature = "serde", serde(default, rename = "categorie"))]
    pub category: i64,
    #[cfg_attr(feature = "serde", serde(default, rename = "param"))]
    pub parameter: i64,
    #[cfg_attr(feature = "serde", serde(default, rename = "paramSub"))]
    pub sub_parameter: i64,
}

/// Share-code alphabet and slots exported from the installed `chara_edit` catalogue.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarShareCodeSpec {
    pub bits: usize,
    pub alphabet: Vec<String>,
    #[cfg_attr(feature = "serde", serde(rename = "emplacements"))]
    pub slots: Vec<AvatarShareSlot>,
}

/// External evidence or already-produced asset referenced by an OC draft.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum OcReferenceKind {
    Zukan,
    Azalee,
    NieCharacter,
    Png,
    Glb,
    ShareCode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct OcReference {
    pub kind: OcReferenceKind,
    pub value: String,
    #[cfg_attr(feature = "serde", serde(default))]
    pub provenance: Option<String>,
    /// File metadata only. Binary contents never enter the portable JSON document.
    #[cfg_attr(feature = "serde", serde(default))]
    pub bytes: Option<usize>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub sha256: Option<String>,
    /// Syntax-only share-code slots. No category/part meaning is assigned without an oracle.
    #[cfg_attr(feature = "serde", serde(default))]
    pub raw_slots: Option<Vec<usize>>,
}

/// Portable OC draft produced by Chara Edit. Importing it never writes into `data/oc`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(
    feature = "serde",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct OcAvatarDocument {
    pub schema: String,
    pub slug: String,
    pub internal_code: Option<String>,
    pub avatar_state: AvatarState,
    /// Optional serialized `aphrody_nie_ocgen::recipe::Recipe`. The no-std owner keeps it opaque; the
    /// ocgen adapter validates the typed recipe before any filesystem-backed generation.
    #[cfg_attr(feature = "serde", serde(default))]
    pub generation_recipe: Option<serde_json::Value>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub references: Vec<OcReference>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub provenance: Vec<String>,
}

/// Host-provided metadata for a portable OC export. The Rust owner combines it with the
/// already-validated avatar state so browser code never owns the JSON schema.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(
    feature = "serde",
    serde(default, rename_all = "camelCase", deny_unknown_fields)
)]
pub struct OcAvatarExportMetadata {
    pub slug: String,
    pub internal_code: Option<String>,
    pub generation_recipe: Option<serde_json::Value>,
    pub references: Vec<OcReference>,
    pub provenance: Vec<String>,
}

/// Result of importing a supported reference.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "kind", rename_all = "snake_case"))]
pub enum AvatarReferenceImport {
    /// Editable state reconstructed from a local NIE project.
    Editable {
        state: Box<AvatarState>,
        #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
        document: Option<Box<OcAvatarDocument>>,
    },
    /// Validated Zukan query. The `aphrody-nie-zukan` owner decodes it in the host bridge.
    ZukanQuery {
        query: String,
        #[cfg_attr(feature = "serde", serde(rename = "referenceOnly"))]
        reference_only: bool,
    },
    /// Player link from Azalee's real `/chara/<slug|code>` route.
    AzaleePlayer {
        identifier: String,
        #[cfg_attr(feature = "serde", serde(rename = "referenceOnly"))]
        reference_only: bool,
    },
    /// Direct canonical NIE player code.
    NiePlayer {
        #[cfg_attr(feature = "serde", serde(rename = "internalCode"))]
        internal_code: String,
        #[cfg_attr(feature = "serde", serde(rename = "referenceOnly"))]
        reference_only: bool,
    },
    /// Valid share code whose slot semantics are not established by an oracle.
    ShareCode {
        #[cfg_attr(feature = "serde", serde(rename = "rawSlots"))]
        raw_slots: Vec<usize>,
        #[cfg_attr(feature = "serde", serde(rename = "referenceOnly"))]
        reference_only: bool,
    },
}

/// Rejection reason kept transport-neutral for WASM, HTTP and native hosts.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "code", rename_all = "snake_case"))]
pub enum AvatarReferenceError {
    Empty,
    TooLarge,
    UnsupportedHost,
    InvalidReference,
    MissingShareSpec,
    InvalidShareSpec,
    InvalidShareCode,
    InvalidProject,
    InvalidAvatar { reason: String },
}

impl fmt::Display for AvatarReferenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => f.write_str("Avatar reference is empty"),
            Self::TooLarge => f.write_str("Avatar reference exceeds size limit"),
            Self::UnsupportedHost => f.write_str("Avatar reference host is unsupported"),
            Self::InvalidReference => f.write_str("Avatar reference is invalid"),
            Self::MissingShareSpec => {
                f.write_str("Avatar catalogue has no share-code specification")
            }
            Self::InvalidShareSpec => f.write_str("Avatar share-code specification is invalid"),
            Self::InvalidShareCode => f.write_str("Avatar share code is invalid"),
            Self::InvalidProject => f.write_str("NIE avatar project is invalid"),
            Self::InvalidAvatar { reason } => write!(f, "Imported avatar is invalid: {reason}"),
        }
    }
}

impl core::error::Error for AvatarReferenceError {}

#[cfg(feature = "serde")]
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AvatarProject {
    format: String,
    version: u8,
    state: AvatarState,
}

#[cfg(feature = "serde")]
fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(feature = "serde")]
fn valid_file_metadata(reference: &OcReference, maximum: usize) -> bool {
    match (reference.bytes, reference.sha256.as_deref()) {
        (None, None) => true,
        (Some(bytes), Some(sha256)) => (1..=maximum).contains(&bytes) && valid_sha256(sha256),
        _ => false,
    }
}

#[cfg(feature = "serde")]
fn validate_oc_document(document: &OcAvatarDocument) -> bool {
    document.schema == "nie.oc.avatar-document/v1"
        && valid_player_identifier(&document.slug)
        && document
            .internal_code
            .as_deref()
            .is_none_or(valid_zukan_code)
        && document.references.len() <= 32
        && document.provenance.len() <= 32
        && document.references.iter().all(|reference| {
            let metadata_matches_kind = match reference.kind {
                OcReferenceKind::Png => {
                    reference.raw_slots.is_none()
                        && safe_asset_reference(&reference.value)
                        && valid_file_metadata(reference, 32 * 1024 * 1024)
                }
                OcReferenceKind::Glb => {
                    reference.raw_slots.is_none()
                        && safe_asset_reference(&reference.value)
                        && valid_file_metadata(reference, 64 * 1024 * 1024)
                }
                OcReferenceKind::ShareCode => {
                    reference.bytes.is_none()
                        && reference.sha256.is_none()
                        && reference
                            .raw_slots
                            .as_ref()
                            .is_some_and(|slots| !slots.is_empty())
                }
                OcReferenceKind::Zukan
                | OcReferenceKind::Azalee
                | OcReferenceKind::NieCharacter => {
                    reference.bytes.is_none()
                        && reference.sha256.is_none()
                        && reference.raw_slots.is_none()
                }
            };
            metadata_matches_kind
                && !reference.value.is_empty()
                && reference.value.len() <= 2_048
                && !reference.value.chars().any(char::is_control)
                && reference.provenance.as_ref().is_none_or(|value| {
                    value.len() <= 2_048 && !value.chars().any(char::is_control)
                })
                && reference.raw_slots.as_ref().is_none_or(|slots| {
                    slots.len() <= 128 && slots.iter().all(|value| *value <= u32::MAX as usize)
                })
        })
        && document.provenance.iter().all(|value| {
            !value.is_empty() && value.len() <= 2_048 && !value.chars().any(char::is_control)
        })
}

#[cfg(feature = "serde")]
fn safe_asset_reference(value: &str) -> bool {
    if value.is_empty()
        || value != value.trim()
        || value.len() > 2_048
        || value.chars().any(char::is_control)
    {
        return false;
    }
    if value.starts_with("data/") {
        return !value
            .bytes()
            .any(|byte| matches!(byte, b'\\' | b'?' | b'#'))
            && !value.split('/').any(|segment| !safe_vfs_segment(segment));
    }
    if value.starts_with("//") {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let authority = value
            .split_once("://")
            .map(|(_, tail)| tail.split(['/', '?', '#']).next().unwrap_or_default())
            .unwrap_or_default();
        return !authority.is_empty() && !authority.contains('@');
    }
    // Relative same-origin references are resolved by the host. Any explicit non-HTTP scheme is
    // rejected here before a browser can interpret `file:`, `data:`, `javascript:` or `blob:`.
    !value
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .contains(':')
}

/// Build and validate the canonical portable OC document without performing filesystem I/O.
#[cfg(feature = "serde")]
pub fn export_avatar_oc_document(
    catalog: &AvatarCatalog,
    state: &AvatarState,
    metadata: OcAvatarExportMetadata,
) -> Result<OcAvatarDocument, AvatarReferenceError> {
    resolve_avatar(catalog, state).map_err(|error| AvatarReferenceError::InvalidAvatar {
        reason: error.to_string(),
    })?;
    let document = OcAvatarDocument {
        schema: "nie.oc.avatar-document/v1".into(),
        slug: metadata.slug,
        internal_code: metadata.internal_code,
        avatar_state: state.clone(),
        generation_recipe: metadata.generation_recipe,
        references: metadata.references,
        provenance: metadata.provenance,
    };
    if !validate_oc_document(&document) {
        return Err(AvatarReferenceError::InvalidProject);
    }
    Ok(document)
}

#[cfg(feature = "serde")]
fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(feature = "serde")]
fn percent_decode_path_segment(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                output.push((hex_nibble(bytes[index + 1])? << 4) | hex_nibble(bytes[index + 2])?);
                index += 3;
            }
            b'%' => return None,
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(output).ok()
}

#[cfg(feature = "serde")]
fn safe_vfs_segment(value: &str) -> bool {
    const MAX_DECODE_PASSES: usize = 4;
    let mut decoded = value.to_string();
    for _ in 0..MAX_DECODE_PASSES {
        let Some(next) = percent_decode_path_segment(&decoded) else {
            return false;
        };
        if next == decoded {
            return !decoded.is_empty()
                && decoded != "."
                && decoded != ".."
                && !decoded
                    .bytes()
                    .any(|byte| matches!(byte, b'/' | b'\\' | b'?' | b'#' | b'\0'));
        }
        decoded = next;
    }
    // Bound recursive decoding: a fifth transformation means the input is deliberately
    // over-encoded and cannot be a canonical VFS segment.
    percent_decode_path_segment(&decoded).is_some_and(|next| {
        next == decoded
            && !decoded.is_empty()
            && decoded != "."
            && decoded != ".."
            && !decoded
                .bytes()
                .any(|byte| matches!(byte, b'/' | b'\\' | b'?' | b'#' | b'\0'))
    })
}

#[cfg(feature = "serde")]
fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                output.push((hex_nibble(bytes[index + 1])? << 4) | hex_nibble(bytes[index + 2])?);
                index += 3;
            }
            b'%' => return None,
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(output).ok()
}

#[cfg(feature = "serde")]
fn query_value(query: &str, key: &str) -> Option<String> {
    query
        .split(['?', '#'])
        .nth(1)
        .unwrap_or(query)
        .split('&')
        .find_map(|pair| {
            let (name, value) = pair.split_once('=')?;
            (name == key).then(|| percent_decode(value)).flatten()
        })
}

#[cfg(feature = "serde")]
/// Host of the NIE wiki whose `chara/<id>` links are accepted: host of `NIE_WIKI_BASE`, else the public default.
fn wiki_host() -> String {
    std::env::var("NIE_WIKI_BASE")
        .ok()
        .and_then(|base| url_host(base.trim()).map(str::to_owned))
        .unwrap_or_else(|| "azalee.rosegriffon.fr".to_owned())
}

#[cfg(feature = "serde")]
fn url_host(value: &str) -> Option<&str> {
    let tail = value.split_once("://")?.1;
    Some(tail.split(['/', '?', '#']).next().unwrap_or(tail))
}

#[cfg(feature = "serde")]
fn valid_zukan_code(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 9
        && bytes[0].eq_ignore_ascii_case(&b'c')
        && bytes[1..].iter().all(u8::is_ascii_digit)
}

#[cfg(feature = "serde")]
fn valid_zukan_query(value: &str) -> bool {
    (16..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'%'))
}

#[cfg(feature = "serde")]
fn valid_player_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[cfg(feature = "serde")]
fn validate_spec(spec: &AvatarShareCodeSpec) -> bool {
    spec.alphabet.len() == 64
        && spec.alphabet.iter().all(|value| value.chars().count() == 1)
        && spec
            .alphabet
            .iter()
            .enumerate()
            .all(|(index, value)| !spec.alphabet[..index].contains(value))
        && !spec.slots.is_empty()
        && spec.slots.iter().map(|slot| slot.bits).sum::<usize>() == spec.bits
        && spec
            .slots
            .iter()
            .all(|slot| slot.bits <= 31 && slot.values > 0 && slot.values <= (1usize << slot.bits))
}

#[cfg(feature = "serde")]
fn decode_share_code(
    spec: &AvatarShareCodeSpec,
    code: &str,
) -> Result<Vec<usize>, AvatarReferenceError> {
    if !validate_spec(spec) {
        return Err(AvatarReferenceError::InvalidShareSpec);
    }
    let expected_characters = spec.bits.div_ceil(6);
    if code.chars().count() != expected_characters {
        return Err(AvatarReferenceError::InvalidShareCode);
    }
    let mut bits = Vec::with_capacity(expected_characters * 6);
    for character in code.chars() {
        let text = character.to_string();
        let index = spec
            .alphabet
            .iter()
            .position(|value| value == &text)
            .ok_or(AvatarReferenceError::InvalidShareCode)?;
        for shift in (0..6).rev() {
            bits.push((index >> shift) & 1);
        }
    }
    // The final alphabet symbol is canonical only when every bit beyond the declared payload is
    // zero. Accepting aliases with arbitrary padding would give one avatar several share codes.
    if bits[spec.bits..].iter().any(|bit| *bit != 0) {
        return Err(AvatarReferenceError::InvalidShareCode);
    }
    let mut cursor = 0;
    let mut values = Vec::with_capacity(spec.slots.len());
    for slot in &spec.slots {
        let mut value = 0usize;
        for _ in 0..slot.bits {
            value = (value << 1) | bits[cursor];
            cursor += 1;
        }
        if value >= slot.values {
            return Err(AvatarReferenceError::InvalidShareCode);
        }
        values.push(value);
    }
    Ok(values)
}

#[cfg(feature = "serde")]
fn import_share_code(
    catalog: &AvatarCatalog,
    code: &str,
) -> Result<AvatarReferenceImport, AvatarReferenceError> {
    let spec = catalog
        .share_code
        .as_ref()
        .ok_or(AvatarReferenceError::MissingShareSpec)?;
    Ok(AvatarReferenceImport::ShareCode {
        raw_slots: decode_share_code(spec, code)?,
        reference_only: true,
    })
}

/// Imports a bounded local project, a raw share code, or a validated player-link intent.
///
/// Zukan results are identities only. Resolving their metadata/model remains host I/O and the
/// returned `referenceOnly` flag prevents the host from claiming an editable conversion.
#[cfg(feature = "serde")]
pub fn import_avatar_reference(
    catalog: &AvatarCatalog,
    _current: &AvatarState,
    reference: &str,
) -> Result<AvatarReferenceImport, AvatarReferenceError> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Err(AvatarReferenceError::Empty);
    }
    if reference.len() > 100_000 {
        return Err(AvatarReferenceError::TooLarge);
    }
    if reference.starts_with('{') {
        if let Ok(document) = serde_json::from_str::<OcAvatarDocument>(reference) {
            if !validate_oc_document(&document) {
                return Err(AvatarReferenceError::InvalidProject);
            }
            resolve_avatar(catalog, &document.avatar_state).map_err(|error| {
                AvatarReferenceError::InvalidAvatar {
                    reason: error.to_string(),
                }
            })?;
            return Ok(AvatarReferenceImport::Editable {
                state: Box::new(document.avatar_state.clone()),
                document: Some(Box::new(document)),
            });
        }
        let project: AvatarProject =
            serde_json::from_str(reference).map_err(|_| AvatarReferenceError::InvalidProject)?;
        if project.format != "nie-avatar" || project.version != 1 {
            return Err(AvatarReferenceError::InvalidProject);
        }
        resolve_avatar(catalog, &project.state).map_err(|error| {
            AvatarReferenceError::InvalidAvatar {
                reason: error.to_string(),
            }
        })?;
        return Ok(AvatarReferenceImport::Editable {
            state: Box::new(project.state),
            document: None,
        });
    }

    if let Some(host) = url_host(reference) {
        if host.eq_ignore_ascii_case("zukan.inazuma.jp") {
            let query =
                query_value(reference, "q").ok_or(AvatarReferenceError::InvalidReference)?;
            if !valid_zukan_query(&query) {
                return Err(AvatarReferenceError::InvalidReference);
            }
            return Ok(AvatarReferenceImport::ZukanQuery {
                query,
                reference_only: true,
            });
        }
        if host.eq_ignore_ascii_case(&wiki_host()) {
            let tail = reference
                .split_once("://")
                .map_or(reference, |(_, tail)| tail);
            let identifier = tail
                .split(['?', '#'])
                .next()
                .unwrap_or(tail)
                .split('/')
                .collect::<Vec<_>>()
                .windows(2)
                .find_map(|segments| {
                    (segments[0] == "chara")
                        .then(|| percent_decode(segments[1]))
                        .flatten()
                })
                .ok_or(AvatarReferenceError::InvalidReference)?;
            if !valid_player_identifier(&identifier) {
                return Err(AvatarReferenceError::InvalidReference);
            }
            return Ok(AvatarReferenceImport::AzaleePlayer {
                identifier,
                reference_only: true,
            });
        }
        return Err(AvatarReferenceError::UnsupportedHost);
    }

    if valid_zukan_code(reference) {
        return Ok(AvatarReferenceImport::NiePlayer {
            internal_code: reference.to_ascii_lowercase(),
            reference_only: true,
        });
    }
    import_share_code(catalog, reference)
}

#[cfg(all(test, feature = "serde"))]
mod tests {
    use super::*;
    use crate::avatar::{AvatarBaseModels, AvatarCategory, AvatarFaceBase, AvatarPart};
    use alloc::format;
    use alloc::vec;

    fn catalog() -> AvatarCatalog {
        AvatarCatalog {
            categories: vec![
                AvatarCategory {
                    setting_type: 4,
                    parts: vec![part("eye-a"), part("eye-b")],
                    colors: vec![],
                },
                AvatarCategory {
                    setting_type: 17,
                    parts: vec![
                        AvatarPart {
                            id: "body-male".into(),
                            resource: "edit_body_male".into(),
                            secondary_models: vec![
                                "data/common/chr/_face/20_EDIT/_bodySK/sk_male/sk_male.g4sk".into(),
                            ],
                            ..AvatarPart::default()
                        },
                        AvatarPart {
                            id: "body-female".into(),
                            resource: "edit_body_female".into(),
                            secondary_models: vec![
                                "data/common/chr/_face/20_EDIT/_bodySK/sk_female/sk_female.g4sk"
                                    .into(),
                            ],
                            ..AvatarPart::default()
                        },
                    ],
                    colors: vec![],
                },
                AvatarCategory {
                    setting_type: 9,
                    parts: vec![AvatarPart {
                        id: "D64E1016".into(),
                        ..AvatarPart::default()
                    }],
                    colors: vec![],
                },
            ],
            base_models: AvatarBaseModels {
                morphologies: vec!["male".into(), "female".into()],
                faces: vec![AvatarFaceBase {
                    nose_type: "nose_type_01".into(),
                    resources: vec!["male_nose".into(), "female_nose".into()],
                }],
            },
            share_code: Some(AvatarShareCodeSpec {
                bits: 4,
                alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"
                    .chars()
                    .map(|c| c.to_string())
                    .collect(),
                slots: vec![
                    AvatarShareSlot {
                        bits: 1,
                        values: 2,
                        ..AvatarShareSlot::default()
                    },
                    AvatarShareSlot {
                        bits: 1,
                        values: 2,
                        ..AvatarShareSlot::default()
                    },
                    AvatarShareSlot {
                        bits: 1,
                        values: 2,
                        ..AvatarShareSlot::default()
                    },
                    AvatarShareSlot {
                        bits: 1,
                        values: 1,
                        ..AvatarShareSlot::default()
                    },
                ],
            }),
            ..AvatarCatalog::default()
        }
    }

    fn part(id: &str) -> AvatarPart {
        AvatarPart {
            id: id.into(),
            resource: id.into(),
            ..AvatarPart::default()
        }
    }

    #[test]
    fn decodes_share_code_without_inventing_slot_semantics() {
        // Alphabet index 40 = binary 101000. The four measured bits stay four raw values.
        assert_eq!(
            import_avatar_reference(&catalog(), &AvatarState::default(), "e").unwrap(),
            AvatarReferenceImport::ShareCode {
                raw_slots: vec![1, 0, 1, 0],
                reference_only: true
            }
        );

        // Four payload bits require exactly one alphabet symbol and two zero padding bits.
        for alias in ["e0", "f"] {
            assert!(matches!(
                import_avatar_reference(&catalog(), &AvatarState::default(), alias),
                Err(AvatarReferenceError::InvalidShareCode)
            ));
        }

        let mut out_of_range = catalog();
        out_of_range.share_code.as_mut().unwrap().slots = vec![AvatarShareSlot {
            bits: 2,
            values: 3,
            ..AvatarShareSlot::default()
        }];
        out_of_range.share_code.as_mut().unwrap().bits = 2;
        // Alphabet index 48 is `110000`: value 3 is outside `0..3`, despite canonical padding.
        assert!(matches!(
            import_avatar_reference(&out_of_range, &AvatarState::default(), "m"),
            Err(AvatarReferenceError::InvalidShareCode)
        ));
    }

    #[test]
    fn validates_real_zukan_query_and_azalee_character_path_without_claiming_a_recipe() {
        let query = "hN2cl56NnpyLmo2glpvdxaTdnM_Kz83LyM_P3aKC";
        assert_eq!(
            import_avatar_reference(
                &catalog(),
                &AvatarState::default(),
                &format!("https://zukan.inazuma.jp/fr/chara_model_view/?q={query}")
            )
            .unwrap(),
            AvatarReferenceImport::ZukanQuery {
                query: query.into(),
                reference_only: true
            }
        );
        assert!(matches!(
            import_avatar_reference(
                &catalog(),
                &AvatarState::default(),
                "https://zukan.inazuma.jp/chara_model_view/?q=../../etc"
            ),
            Err(AvatarReferenceError::InvalidReference)
        ));
        assert_eq!(
            import_avatar_reference(
                &catalog(),
                &AvatarState::default(),
                "https://azalee.rosegriffon.fr/chara/astro-lor"
            )
            .unwrap(),
            AvatarReferenceImport::AzaleePlayer {
                identifier: "astro-lor".into(),
                reference_only: true,
            }
        );
        assert!(matches!(
            import_avatar_reference(
                &catalog(),
                &AvatarState::default(),
                "https://azalee.rosegriffon.fr/avatar?code=e"
            ),
            Err(AvatarReferenceError::InvalidReference)
        ));
    }

    #[test]
    fn imports_only_versioned_nie_projects_and_validates_the_recipe() {
        let state = AvatarState {
            gender: 0,
            morphology: 0,
            ..AvatarState::default()
        };
        let project = format!(
            r#"{{"format":"nie-avatar","version":1,"state":{}}}"#,
            serde_json::to_string(&state).unwrap()
        );
        assert!(matches!(
            import_avatar_reference(&catalog(), &state, &project),
            Ok(AvatarReferenceImport::Editable { .. })
        ));
        assert!(matches!(
            import_avatar_reference(
                &catalog(),
                &state,
                r#"{"format":"nie-avatar","version":2,"state":{}}"#
            ),
            Err(AvatarReferenceError::InvalidProject)
        ));
        let mut oc_state = serde_json::to_value(&state).unwrap();
        oc_state["profile"] = serde_json::json!({
            "kick":279,"control":265,"technique":267,"pressure":250,
            "physical":242,"agility":256,"intelligence":279
        });
        let oc = serde_json::json!({
            "schema": "nie.oc.avatar-document/v1",
            "slug": "new-oc",
            "internalCode": null,
            "avatarState": oc_state,
            "references": [{
                "kind":"png", "value":"face.png", "provenance":"author upload",
                "bytes":1024, "sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }],
            "provenance": ["Chara Edit session"]
        });
        let imported =
            import_avatar_reference(&catalog(), &AvatarState::default(), &oc.to_string()).unwrap();
        let AvatarReferenceImport::Editable {
            document: Some(document),
            ..
        } = imported
        else {
            panic!("OC document")
        };
        assert_eq!(document.slug, "new-oc");
        assert_eq!(document.references[0].kind, OcReferenceKind::Png);
        assert_eq!(document.references[0].bytes, Some(1024));
        assert_eq!(document.avatar_state.profile.kick, Some(279));

        for unsafe_value in [
            "file:///tmp/avatar.glb",
            "data:model/gltf-binary;base64,AA==",
            "javascript:alert(1)",
            "https://user@example.test/avatar.glb",
            "//example.test/avatar.glb",
            "data/../secret.glb",
            "data/foo\\bar.glb",
            "data/avatar.glb?download=1",
            "data/avatar.glb#part",
            "data/%2e%2e/secret.glb",
            "data/.%2e/secret.glb",
            "data/%2e%252e/secret.glb",
            "data/%252e%252e/secret.glb",
            "data/%2fetc/avatar.glb",
            "data/%255cetc/avatar.glb",
            "data/avatar.glb%3fdownload=1",
            "data/avatar.glb%23part",
        ] {
            let mut unsafe_oc = oc.clone();
            unsafe_oc["references"][0]["value"] = serde_json::Value::String(unsafe_value.into());
            assert!(matches!(
                import_avatar_reference(
                    &catalog(),
                    &AvatarState::default(),
                    &unsafe_oc.to_string()
                ),
                Err(AvatarReferenceError::InvalidProject)
            ));
        }
    }

    #[test]
    fn validates_oc_file_metadata_at_kind_specific_boundaries() {
        const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let document = |kind: &str, value: &str, bytes: Option<usize>, sha256: Option<&str>| {
            serde_json::json!({
                "schema": "nie.oc.avatar-document/v1",
                "slug": "bounded-reference",
                "internalCode": null,
                "avatarState": AvatarState::default(),
                "references": [{
                    "kind": kind,
                    "value": value,
                    "bytes": bytes,
                    "sha256": sha256
                }],
                "provenance": []
            })
        };
        let valid = |value: serde_json::Value| {
            matches!(
                import_avatar_reference(&catalog(), &AvatarState::default(), &value.to_string()),
                Ok(AvatarReferenceImport::Editable { .. })
            )
        };

        // Filename-only references remain valid provenance. Once metadata is present, both
        // fields are mandatory and the positive size bound is specific to the file kind.
        assert!(valid(document("png", "face.png", None, None)));
        assert!(valid(document("png", "face.png", Some(1), Some(SHA256))));
        assert!(valid(document(
            "png",
            "face.png",
            Some(32 * 1024 * 1024),
            Some(SHA256)
        )));
        assert!(!valid(document("png", "face.png", Some(0), Some(SHA256))));
        assert!(!valid(document(
            "png",
            "face.png",
            Some(32 * 1024 * 1024 + 1),
            Some(SHA256)
        )));
        assert!(!valid(document("png", "face.png", Some(1), None)));
        assert!(!valid(document("png", "face.png", None, Some(SHA256))));

        assert!(valid(document("glb", "avatar.glb", None, None)));
        assert!(valid(document("glb", "avatar.glb", Some(1), Some(SHA256))));
        assert!(valid(document(
            "glb",
            "avatar.glb",
            Some(64 * 1024 * 1024),
            Some(SHA256)
        )));
        assert!(!valid(document("glb", "avatar.glb", Some(0), Some(SHA256))));
        assert!(!valid(document(
            "glb",
            "avatar.glb",
            Some(64 * 1024 * 1024 + 1),
            Some(SHA256)
        )));

        for (kind, value) in [
            (
                "zukan",
                "https://zukan.inazuma.jp/fr/chara_model_view/?q=reference",
            ),
            ("azalee", "https://azalee.rosegriffon.fr/chara/astro-lor"),
            ("nie_character", "c99019010"),
        ] {
            assert!(valid(document(kind, value, None, None)));
            assert!(!valid(document(kind, value, Some(1), Some(SHA256))));
        }
    }

    #[test]
    fn rejects_untrusted_hosts_and_malformed_share_specs() {
        assert!(matches!(
            import_avatar_reference(
                &catalog(),
                &AvatarState::default(),
                "https://evil.test/avatar?code=e"
            ),
            Err(AvatarReferenceError::UnsupportedHost)
        ));
        let mut invalid = catalog();
        invalid.share_code.as_mut().unwrap().alphabet.pop();
        assert!(matches!(
            import_avatar_reference(&invalid, &AvatarState::default(), "e"),
            Err(AvatarReferenceError::InvalidShareSpec)
        ));
    }

    #[test]
    fn rust_owner_exports_the_versioned_oc_document_and_rejects_invalid_metadata() {
        let state = AvatarState {
            profile: crate::avatar::AvatarProfile {
                kick: Some(120),
                intelligence: Some(130),
                ..crate::avatar::AvatarProfile::default()
            },
            ..AvatarState::default()
        };
        let document = export_avatar_oc_document(
            &catalog(),
            &state,
            OcAvatarExportMetadata {
                slug: "rust-owned-oc".into(),
                references: vec![OcReference {
                    kind: OcReferenceKind::Glb,
                    value: "avatar.glb".into(),
                    provenance: Some("validated by aphrody-nie-render3d".into()),
                    bytes: Some(4096),
                    sha256: Some("a".repeat(64)),
                    raw_slots: None,
                }],
                ..OcAvatarExportMetadata::default()
            },
        )
        .unwrap();
        assert_eq!(document.schema, "nie.oc.avatar-document/v1");
        assert_eq!(document.avatar_state.profile.kick, Some(120));
        assert_eq!(document.references[0].bytes, Some(4096));

        assert!(matches!(
            export_avatar_oc_document(
                &catalog(),
                &state,
                OcAvatarExportMetadata {
                    slug: "invalid slug".into(),
                    ..OcAvatarExportMetadata::default()
                }
            ),
            Err(AvatarReferenceError::InvalidProject)
        ));
    }
}
