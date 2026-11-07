// SPDX-License-Identifier: Apache-2.0
//! Ingestion du catalogue de formats exporté par iecode (`iecode export-knowledge`).
//!
//! iecode (C# .NET 10) ne peut pas être appelé depuis nie (full-Rust). Il publie
//! donc son savoir sur les formats binaires LEVEL-5 / CRIWARE d'IEVR sous forme d'un
//! artefact JSON stable et versionné, produit par :
//!
//! ```sh
//! iecode export-knowledge --out <catalogue.json>
//! ```
//!
//! Ce module lit ce JSON et l'ingère comme ancres de vérité :
//! - each documented format → a validated record with name, magic, and extensions;
//! - each documented header field → a bounded field record (offset, size, type, name, note).
//!
//! ## Schéma JSON attendu (schema_version 1)
//!
//! ```json
//! {
//!   "schema_version": 1,
//!   "generator": "iecode",
//!   "game": "Inazuma Eleven: Victory Road",
//!   "format_count": 31,
//!   "formats": [
//!     {
//!       "name": "G4TX",
//!       "category": "Texture",
//!       "extensions": ["g4tx"],
//!       "magic": "\"G4TX\"",
//!       "magic_hex": 1481913415,
//!       "endianness": "Little",
//!       "header_size": 96,
//!       "description": "Conteneur de textures LEVEL-5 …",
//!       "doc": "Formats/Level5/G4txParser.cs",
//!       "fields": [
//!         { "offset": 0, "size": 4, "type": "magic", "name": "Magic", "note": "\"G4TX\" …" }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! This parser keeps the browser WASM interface aligned with iecode exports without
//! pulling in native reverse-engineering database storage.


use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Version de schéma supportée par cet ingesteur. Doit correspondre au
/// `schema_version` produit par `iecode export-knowledge`.
pub const SUPPORTED_SCHEMA_VERSION: i64 = 1;

/// Resource limits applied while parsing an exported format catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogLimits {
    /// Maximum accepted JSON payload size in bytes.
    pub max_input_bytes: usize,
    /// Maximum number of format entries.
    pub max_formats: usize,
    /// Maximum number of fields in one format entry.
    pub max_fields_per_format: usize,
    /// Maximum number of filename extensions in one format entry.
    pub max_extensions_per_format: usize,
    /// Maximum number of fields across the complete catalog.
    pub max_total_fields: usize,
    /// Maximum UTF-8 byte length of any retained string.
    pub max_string_bytes: usize,
}

impl Default for CatalogLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 2 * 1024 * 1024,
            max_formats: 256,
            max_fields_per_format: 512,
            max_extensions_per_format: 64,
            max_total_fields: 8_192,
            max_string_bytes: 16 * 1024,
        }
    }
}

/// A validated machine-readable format catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatCatalog {
    /// Catalog schema version.
    pub schema_version: i64,
    /// Name of the catalog generator, when provided.
    #[serde(default)]
    pub generator: String,
    /// Game identifier supplied by the catalog producer, when provided.
    #[serde(default)]
    pub game: Option<String>,
    /// Number of formats declared by the producer, when provided.
    #[serde(default)]
    pub format_count: Option<usize>,
    /// Format entries in producer order.
    #[serde(default)]
    pub formats: Vec<FormatEntry>,
}

impl FormatCatalog {
    /// Find a format by its exact canonical name.
    #[must_use]
    pub fn format(&self, name: &str) -> Option<&FormatEntry> {
        self.formats.iter().find(|format| format.name == name)
    }

    /// Count all documented header fields in the catalog.
    #[must_use]
    pub fn total_fields(&self) -> usize {
        self.formats.iter().map(|format| format.fields.len()).sum()
    }
}

/// One format definition from the exported catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatEntry {
    /// Canonical format name, for example `G4TX`, `G4MG`, or `cfg.bin`.
    pub name: String,
    /// Producer-defined format category.
    #[serde(default)]
    pub category: Option<String>,
    /// VFS filename extensions associated with this format.
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Human-readable magic representation, when the format has one.
    #[serde(default)]
    pub magic: Option<String>,
    /// Numeric magic representation emitted by the producer.
    #[serde(default)]
    pub magic_hex: Option<u64>,
    /// Producer-defined byte order.
    #[serde(default)]
    pub endianness: Option<String>,
    /// Documented header size in bytes.
    #[serde(default)]
    pub header_size: Option<u64>,
    /// Human-readable format description.
    #[serde(default)]
    pub description: Option<String>,
    /// Source document or parser path.
    #[serde(default)]
    pub doc: Option<String>,
    /// Documented header fields.
    #[serde(default)]
    pub fields: Vec<FieldEntry>,
}

/// One documented field in a format header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldEntry {
    /// Byte offset, when known.
    #[serde(default)]
    pub offset: Option<i64>,
    /// Field size in bytes, when known.
    #[serde(default)]
    pub size: Option<i64>,
    /// Producer-defined field type.
    #[serde(rename = "type")]
    #[serde(default)]
    pub ty: Option<String>,
    /// Field name.
    pub name: String,
    /// Optional field note.
    #[serde(default)]
    pub note: Option<String>,
}

/// Failure returned by [`parse_format_catalog_bytes`].
#[derive(Debug, Error)]
pub enum CatalogParseError {
    /// The JSON payload exceeded the configured byte limit.
    #[error("catalog input is {actual} bytes; limit is {limit} bytes")]
    InputTooLarge { actual: usize, limit: usize },
    /// The payload was not valid catalog JSON.
    #[error("invalid format catalog JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    /// The payload uses a schema this crate cannot interpret safely.
    #[error("unsupported schema_version {actual}; expected {expected}")]
    UnsupportedSchema { actual: i64, expected: i64 },
    /// The payload contained more formats than allowed.
    #[error("catalog contains {actual} formats; limit is {limit}")]
    TooManyFormats { actual: usize, limit: usize },
    /// One format contained more fields than allowed.
    #[error("format {format_name:?} contains {actual} fields; limit is {limit}")]
    TooManyFields {
        format_name: String,
        actual: usize,
        limit: usize,
    },
    /// One format contained more filename extensions than allowed.
    #[error("format {format_name:?} contains {actual} extensions; limit is {limit}")]
    TooManyExtensions {
        format_name: String,
        actual: usize,
        limit: usize,
    },
    /// The total field count exceeded the configured limit.
    #[error("catalog contains more than {limit} fields")]
    TooManyTotalFields { limit: usize },
    /// A required format or field name was empty.
    #[error("{location} must not be empty")]
    EmptyName { location: String },
    /// A retained string exceeded the configured limit.
    #[error("{location} is {actual} bytes; string limit is {limit} bytes")]
    StringTooLong {
        location: String,
        actual: usize,
        limit: usize,
    },
}

/// Parse and validate an exported iecode format catalog from bytes.
///
/// The input-size check happens before JSON allocation. Limits on entries, fields,
/// and strings are then enforced before the catalog is returned to a caller such
/// as a WebAssembly binding.
///
/// # Errors
///
/// Returns [`CatalogParseError`] for invalid JSON, unsupported schemas, or any
/// configured resource limit violation.
pub fn parse_format_catalog_bytes(
    bytes: &[u8],
    limits: CatalogLimits,
) -> Result<FormatCatalog, CatalogParseError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(CatalogParseError::InputTooLarge {
            actual: bytes.len(),
            limit: limits.max_input_bytes,
        });
    }

    let catalog: FormatCatalog = serde_json::from_slice(bytes)?;
    validate_catalog(&catalog, limits)?;
    Ok(catalog)
}

fn validate_catalog(
    catalog: &FormatCatalog,
    limits: CatalogLimits,
) -> Result<(), CatalogParseError> {
    if catalog.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(CatalogParseError::UnsupportedSchema {
            actual: catalog.schema_version,
            expected: SUPPORTED_SCHEMA_VERSION,
        });
    }
    if catalog.formats.len() > limits.max_formats {
        return Err(CatalogParseError::TooManyFormats {
            actual: catalog.formats.len(),
            limit: limits.max_formats,
        });
    }

    check_string("generator", &catalog.generator, limits.max_string_bytes)?;
    check_optional_string("game", catalog.game.as_deref(), limits)?;
    let mut total_fields = 0usize;
    for format in &catalog.formats {
        check_required_name("format name", &format.name, limits.max_string_bytes)?;
        check_optional_string("format category", format.category.as_deref(), limits)?;
        check_optional_string("format magic", format.magic.as_deref(), limits)?;
        check_optional_string("format endianness", format.endianness.as_deref(), limits)?;
        check_optional_string("format description", format.description.as_deref(), limits)?;
        check_optional_string("format document", format.doc.as_deref(), limits)?;
        if format.extensions.len() > limits.max_extensions_per_format {
            return Err(CatalogParseError::TooManyExtensions {
                format_name: format.name.clone(),
                actual: format.extensions.len(),
                limit: limits.max_extensions_per_format,
            });
        }
        for extension in &format.extensions {
            check_string("format extension", extension, limits.max_string_bytes)?;
        }

        if format.fields.len() > limits.max_fields_per_format {
            return Err(CatalogParseError::TooManyFields {
                format_name: format.name.clone(),
                actual: format.fields.len(),
                limit: limits.max_fields_per_format,
            });
        }
        total_fields = total_fields.saturating_add(format.fields.len());
        if total_fields > limits.max_total_fields {
            return Err(CatalogParseError::TooManyTotalFields {
                limit: limits.max_total_fields,
            });
        }

        for field in &format.fields {
            check_required_name("field name", &field.name, limits.max_string_bytes)?;
            check_optional_string("field type", field.ty.as_deref(), limits)?;
            check_optional_string("field note", field.note.as_deref(), limits)?;
        }
    }
    Ok(())
}

fn check_required_name(
    location: &str,
    value: &str,
    max_string_bytes: usize,
) -> Result<(), CatalogParseError> {
    if value.trim().is_empty() {
        return Err(CatalogParseError::EmptyName {
            location: location.to_owned(),
        });
    }
    check_string(location, value, max_string_bytes)
}

fn check_optional_string(
    location: &str,
    value: Option<&str>,
    limits: CatalogLimits,
) -> Result<(), CatalogParseError> {
    if let Some(value) = value {
        check_string(location, value, limits.max_string_bytes)?;
    }
    Ok(())
}

fn check_string(
    location: &str,
    value: &str,
    max_string_bytes: usize,
) -> Result<(), CatalogParseError> {
    if value.len() > max_string_bytes {
        return Err(CatalogParseError::StringTooLong {
            location: location.to_owned(),
            actual: value.len(),
            limit: max_string_bytes,
        });
    }
    Ok(())
}

/// Résultat d'une passe d'ingestion du catalogue.
#[derive(Debug, Default, Clone, Copy)]
pub struct CatalogStats {
    /// Nombre de formats insérés/mis à jour.
    pub formats: usize,
    /// Nombre de champs d'en-tête insérés.
    pub fields: usize,
}

