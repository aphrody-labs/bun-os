// SPDX-License-Identifier: Apache-2.0
//! WebAssembly bindings of the DBXV2 game engine (feature `wasm`), absorbed from an earlier DBXV2 RE crate.
//!
//! Exposes CPK archive triage, CRILAYLA decompression, CUS skill decoding,
//! AOB memory scanning, and Dragon Ball game catalog discovery to JS/WASM runtimes.

use crate::game::api;
use crate::game::catalog::get_dragon_ball_catalog;
use crate::game::formats::{
    bac::BacFile, bdm::BdmFile, cus::CusFile, emb_archive::EmbArchive, msg::MsgFile, pup::PupFile,
};
use crate::game::live::aob::AobPattern;
use crate::game::text::extract_msg_text;
use crate::game::world::xenoverse3::xenoverse3_prototype_map;
use aphrody_nie_formats::cpk::{CpkEntry, CpkReader};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Summary of a CPK archive inspection in WebAssembly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpkTriageSummary {
    pub valid: bool,
    pub total_files: usize,
    pub total_file_size: u64,
    pub has_utf_table: bool,
    pub compression_detected: bool,
    pub entries: Vec<CpkEntry>,
}

fn to_js_err(err: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&err.to_string())
}

/// Plain (`CPK `) archives only: the generic bindings never try a title's key derivation.
fn plain_cpk(bytes: &[u8]) -> Result<CpkReader, JsValue> {
    if !bytes.starts_with(b"CPK ") {
        return Err(JsValue::from_str("not a plain CPK (header is not `CPK `)"));
    }
    CpkReader::new(bytes, "").map_err(to_js_err)
}

/// Analyze a CRIWARE CPK archive in-memory and return its file table and metadata
/// (canonical `aphrody-nie-formats` reader).
#[wasm_bindgen]
pub fn wasm_triage_cpk(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let archive = plain_cpk(bytes)?;
    let summary = CpkTriageSummary {
        valid: true,
        total_files: archive.entries.len(),
        total_file_size: archive.entries.iter().map(|e| e.size).sum(),
        has_utf_table: true,
        compression_detected: archive.entries.iter().any(|e| e.is_compressed),
        entries: archive.entries,
    };
    serde_wasm_bindgen::to_value(&summary).map_err(to_js_err)
}

/// Decode an xz-compressed DBXV2 asset (`<kind>/<cpk>/<path>.xz`) in pure Rust.
#[wasm_bindgen]
pub fn wasm_xz_decode(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    crate::game::api::xz_decode(bytes).map_err(to_js_err)
}

/// Extract a single file from a CPK archive by path or name (CRILAYLA is decompressed).
#[wasm_bindgen]
pub fn wasm_extract_cpk_file(archive_bytes: &[u8], filename: &str) -> Result<Vec<u8>, JsValue> {
    let archive = plain_cpk(archive_bytes)?;
    let entry = archive
        .find_file(filename)
        .ok_or_else(|| JsValue::from_str(&format!("{filename}: not in the archive")))?;
    archive.extract(archive_bytes, entry).map_err(to_js_err)
}

/// Decompress a `CRILAYLA` buffer (the magic-prefixed form stored in CPK entries).
#[wasm_bindgen]
pub fn wasm_decompress_crilayla(compressed: &[u8]) -> Result<Vec<u8>, JsValue> {
    aphrody_nie_formats::crilayla::decompress(compressed).map_err(to_js_err)
}

/// Parse a DBXV2 CUS (Character Ultimate Skill) binary file and return all skills.
#[wasm_bindgen]
pub fn wasm_parse_cus(cus_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let cus = CusFile::parse(cus_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&cus).map_err(to_js_err)
}

/// Parse a DBXV2 BAC (Battle Action Code) moveset binary file and return all moves.
#[wasm_bindgen]
pub fn wasm_parse_bac(bac_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let bac = BacFile::parse(bac_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&bac).map_err(to_js_err)
}

/// Parse a DBXV2 BDM (Battle Damage Matrix) binary file and return all damage definitions.
#[wasm_bindgen]
pub fn wasm_parse_bdm(bdm_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let bdm = BdmFile::parse(bdm_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&bdm).map_err(to_js_err)
}

/// Parse a DBXV2 PUP (Power-Up Parameters) binary file and return transformation multipliers.
#[wasm_bindgen]
pub fn wasm_parse_pup(pup_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let pup = PupFile::parse(pup_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&pup).map_err(to_js_err)
}

/// Parse a DBXV2 MSG (Message) binary file and return localized text strings.
#[wasm_bindgen]
pub fn wasm_parse_msg(msg_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let msg = MsgFile::parse(msg_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&msg).map_err(to_js_err)
}

/// Validate a DBXV2 EMB texture archive and return its entry names and byte ranges.
#[wasm_bindgen]
pub fn wasm_parse_emb(emb_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let emb = EmbArchive::parse(emb_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&emb).map_err(to_js_err)
}

/// Extract printable UTF-16LE text runs from one MSG buffer without parsing its table layout.
#[wasm_bindgen]
pub fn wasm_extract_msg_text(file_name: &str, msg_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let report = extract_msg_text(std::path::Path::new(file_name), msg_bytes);
    serde_wasm_bindgen::to_value(&report).map_err(to_js_err)
}

/// Identify a buffer by magic then by `file_name` extension; returns `{format, category, parsable}`.
#[wasm_bindgen]
pub fn wasm_identify_format(bytes: &[u8], file_name: &str) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&api::identify(bytes, file_name)).map_err(to_js_err)
}

/// JSON summary of an EMB/EMD/ESK/EMM/BAC/BCM/BCS/BDM/BSA/EAN/CMS/CUS/PUP/MSG buffer.
#[wasm_bindgen]
pub fn wasm_summarize(bytes: &[u8], file_name: &str) -> Result<JsValue, JsValue> {
    let value = api::summarize(bytes, file_name).map_err(to_js_err)?;
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_err)
}

/// Decode an HCA/ADX/AWB/ACB buffer to WAV images (one `Uint8Array` per subsong). Requires the
/// `dbxv2` feature in addition to `wasm`.
#[cfg(feature = "dbxv2")]
#[wasm_bindgen]
pub fn wasm_audio_to_wav(bytes: &[u8]) -> Result<js_sys::Array, JsValue> {
    let waves = api::audio_to_wav(bytes).map_err(to_js_err)?;
    Ok(waves
        .iter()
        .map(|wave| js_sys::Uint8Array::from(wave.as_slice()))
        .collect())
}

/// Range-read CPK index. `read(offset, len)` is a synchronous JS callback returning a
/// `Uint8Array` of exactly `len` bytes; only the header and table of contents are fetched.
/// `query` is `ext:emb`, a `*`/`?` glob, an exact path, or empty for every entry.
#[wasm_bindgen]
pub fn wasm_cpk_find(
    read: &js_sys::Function,
    label: &str,
    query: &str,
) -> Result<JsValue, JsValue> {
    let index = api::CpkIndex::open(label, label, js_reader(read)).map_err(to_js_err)?;
    let rows = if query.is_empty() {
        index.list()
    } else {
        index.find(query)
    };
    serde_wasm_bindgen::to_value(&rows).map_err(to_js_err)
}

/// Read one CPK entry (CRILAYLA decompressed) through the same range callback; `start`/`len`
/// select a window of the extracted bytes when `len > 0`.
#[wasm_bindgen]
pub fn wasm_cpk_read(
    read: &js_sys::Function,
    label: &str,
    path: &str,
    start: f64,
    len: f64,
) -> Result<Vec<u8>, JsValue> {
    let index = api::CpkIndex::open(label, label, js_reader(read)).map_err(to_js_err)?;
    let range = (len > 0.0).then_some((start as u64, len as u64));
    index.read(path, range, js_reader(read)).map_err(to_js_err)
}

fn js_reader(
    read: &js_sys::Function,
) -> impl FnMut(u64, usize) -> Result<Vec<u8>, aphrody_nie_formats::FormatError> + '_ {
    move |offset, size| {
        let short = || aphrody_nie_formats::FormatError::TooShort { got: 0, need: size };
        let value = read
            .call2(
                &JsValue::NULL,
                &JsValue::from_f64(offset as f64),
                &JsValue::from_f64(size as f64),
            )
            .map_err(|_| short())?;
        Ok(js_sys::Uint8Array::new(&value).to_vec())
    }
}

/// Decode entry `index` of a `#EMB` container to PNG (needs the `dbxv2` feature).
#[cfg(feature = "dbxv2")]
#[wasm_bindgen]
pub fn wasm_emb_to_png(bytes: &[u8], index: usize) -> Result<Vec<u8>, JsValue> {
    api::emb_to_png(bytes, index).map_err(to_js_err)
}

/// Assembled character model JSON from EMD plus optional EMB and ESK.
#[wasm_bindgen]
pub fn wasm_model_json(
    name: &str,
    emd: &[u8],
    emb: Option<Vec<u8>>,
    esk: Option<Vec<u8>>,
) -> Result<JsValue, JsValue> {
    let value = api::model_json(name, emd, emb.as_deref(), esk.as_deref()).map_err(to_js_err)?;
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_err)
}

/// Typed MSG reader (see [`api::msg_read`]).
#[wasm_bindgen]
pub fn wasm_msg_read(bytes: &[u8]) -> Result<JsValue, JsValue> {
    api::msg_read(bytes)
        .map_err(to_js_err)?
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_err)
}

/// ACB cue sheet (needs the `dbxv2` feature).
#[cfg(feature = "dbxv2")]
#[wasm_bindgen]
pub fn wasm_acb_info(bytes: &[u8]) -> Result<JsValue, JsValue> {
    api::acb_info(bytes)
        .map_err(to_js_err)?
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_err)
}

/// What each format yields through this surface (see [`api::support`]).
#[wasm_bindgen]
pub fn wasm_support() -> Result<JsValue, JsValue> {
    api::support()
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_err)
}

/// The model in the field layout of `AssembledModel` (see [`api::model_assembled_json`]).
#[wasm_bindgen]
pub fn wasm_model_assembled_json(
    name: &str,
    emd: &[u8],
    emb: Option<Vec<u8>>,
    esk: Option<Vec<u8>>,
) -> Result<JsValue, JsValue> {
    let value =
        api::model_assembled_json(name, emd, emb.as_deref(), esk.as_deref()).map_err(to_js_err)?;
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_err)
}

/// Same model as binary glTF.
#[wasm_bindgen]
pub fn wasm_model_glb(
    name: &str,
    emd: &[u8],
    emb: Option<Vec<u8>>,
    esk: Option<Vec<u8>>,
) -> Result<Vec<u8>, JsValue> {
    api::model_glb(name, emd, emb.as_deref(), esk.as_deref()).map_err(to_js_err)
}

/// Remux a USM (needs the `dbxv2` feature): returns `{ extension, bytes }` (mp4 for H.264, webm for VP9).
#[cfg(feature = "dbxv2")]
#[wasm_bindgen]
pub fn wasm_usm_to_video(bytes: &[u8]) -> Result<js_sys::Object, JsValue> {
    let (out, extension) = api::usm_to_video(bytes).map_err(to_js_err)?;
    let object = js_sys::Object::new();
    js_sys::Reflect::set(&object, &"extension".into(), &extension.into())?;
    js_sys::Reflect::set(
        &object,
        &"bytes".into(),
        &js_sys::Uint8Array::from(out.as_slice()),
    )?;
    Ok(object)
}

/// Validate an sfnt/WOFF font and return it unchanged (Iggy bundles are refused).
#[wasm_bindgen]
pub fn wasm_font_to_sfnt(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    api::font_to_sfnt(bytes)
        .map(|(out, _)| out)
        .map_err(to_js_err)
}

/// Scan a buffer for an Array-of-Bytes (AOB) pattern with wildcards (e.g. "48 89 5C 24 ??").
#[wasm_bindgen]
pub fn wasm_scan_aob(data: &[u8], pattern: &str) -> Result<Vec<usize>, JsValue> {
    let aob = AobPattern::parse(pattern).map_err(to_js_err)?;
    Ok(aob.scan_all(data, usize::MAX))
}

/// Retrieve the full Dragon Ball game catalog (Steam + Android) as a JavaScript object.
#[wasm_bindgen]
pub fn wasm_get_dragon_ball_catalog() -> Result<JsValue, JsValue> {
    let catalog = get_dragon_ball_catalog();
    serde_wasm_bindgen::to_value(&catalog).map_err(to_js_err)
}

/// Retrieve the source-attributed Xenoverse 3 prototype world map as JavaScript data.
/// Announced places and original prototype geometry are distinguished in each record.
#[wasm_bindgen]
pub fn wasm_get_xenoverse3_prototype_map() -> Result<JsValue, JsValue> {
    let map = xenoverse3_prototype_map();
    serde_wasm_bindgen::to_value(&map).map_err(to_js_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_scan_aob_direct() {
        let buffer = [0x90, 0x48, 0x89, 0x5C, 0x24, 0x20, 0xC3];
        let offsets = wasm_scan_aob(&buffer, "48 89 ?? 24").unwrap();
        assert_eq!(offsets, vec![1]);
    }

    #[test]
    fn test_wasm_catalog_direct() {
        let cat = get_dragon_ball_catalog();
        assert!(cat.len() >= 10);
    }

    #[test]
    fn test_wasm_parse_bdm_direct() {
        let mock = BdmFile::create_mock(5);
        let parsed = BdmFile::parse(&mock).unwrap();
        assert_eq!(parsed.entries.len(), 5);
        assert_eq!(parsed.entries[0].id, 100);
    }

    #[test]
    fn test_wasm_prototype_map_direct() {
        let map = xenoverse3_prototype_map();
        assert_eq!(map.era, "AGE 1000");
        assert!(map.zones.iter().any(|zone| zone.id == "glacier-expedition"));
    }

    #[test]
    fn test_wasm_parse_emb_direct() {
        let bytes = crate::game::formats::emb_archive::tests::fixture(&[("texture.dds", b"DDS!")]);
        let parsed = EmbArchive::parse(&bytes).unwrap();
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].name, "texture.dds");
        assert_eq!(parsed.entries[0].size_bytes, 4);
    }
}
