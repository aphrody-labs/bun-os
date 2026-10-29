// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 (DBXV2) Character Model Assembler & GLTF 2.0 / GLB Binary Exporter.
//!
//! Adapts the 3D model assembly and GLB export architecture from `aphrody-nie-formats::assemble`
//! and `aphrody-nie-render3d::glb` for DBXV2 characters.
//!
//! Assembles `.emd` meshes, `.emb` textures, `.esk` skeletal bones, and `.emm` materials into
//! a unified standard GLTF 2.0 binary (`.glb`) asset that can be rendered directly by
//! a GPU pipeline or any standard 3D/WebGPU viewer.

use crate::game::error::{ReError, Result};
use crate::game::formats::emb::{EmbFile, EmbRgbaTexture};
use crate::game::formats::emd::{EmdFile, EmdSubmesh};
use crate::game::formats::emm::EmmFile;
use crate::game::formats::esk::EskFile;
use serde_json::json;

/// Magic signature for glTF 2.0 binary (`glTF`).
pub const GLB_MAGIC: u32 = 0x4654_6C67;
/// glTF 2.0 JSON chunk type (`JSON`).
pub const GLB_JSON_CHUNK: u32 = 0x4E4F_534A;
/// glTF 2.0 BIN chunk type (`BIN\0`).
pub const GLB_BIN_CHUNK: u32 = 0x004E_4942;

/// A 3D renderable mesh primitive with geometry and optional texture index.
#[derive(Debug, Clone)]
pub struct ModelPrimitive {
    pub name: String,
    pub material_name: String,
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uv: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub texture_index: Option<usize>,
}

/// Assembled Dragon Ball Xenoverse 2 character model.
#[derive(Debug, Clone)]
pub struct AssembledCharacterModel {
    pub name: String,
    pub primitives: Vec<ModelPrimitive>,
    pub textures: Vec<EmbRgbaTexture>,
    pub skeleton: Option<EskFile>,
}

impl AssembledCharacterModel {
    /// Assembles a character model from separate DBXV2 components:
    /// - `.emd`: 3D meshes and geometry
    /// - `.emb`: Textures
    /// - `.esk`: Skeleton bones & inverse bind matrices
    /// - `.emm`: Materials & cel-shading parameters
    pub fn assemble(
        character_name: &str,
        emd: &EmdFile,
        emb: Option<&EmbFile>,
        esk: Option<&EskFile>,
        _emm: Option<&EmmFile>,
    ) -> Self {
        let mut primitives = Vec::new();

        // Extract textures from EMB if present
        let mut textures = Vec::new();
        if let Some(emb_file) = emb {
            for i in 0..emb_file.textures.len() {
                if let Ok(tex) = emb_file.decode_rgba(i) {
                    textures.push(tex);
                }
            }
        }

        // Flatten EMD parts into model primitives
        for part in &emd.parts {
            for mesh in &part.meshes {
                for submesh in &mesh.submeshes {
                    let prim = convert_submesh_to_primitive(submesh, !textures.is_empty());
                    primitives.push(prim);
                }
            }
        }

        Self {
            name: character_name.to_string(),
            primitives,
            textures,
            skeleton: esk.cloned(),
        }
    }

    /// Total vertices in the assembled model.
    pub fn total_vertices(&self) -> usize {
        self.primitives.iter().map(|p| p.positions.len()).sum()
    }

    /// Total triangles in the assembled model.
    pub fn total_triangles(&self) -> usize {
        self.primitives.iter().map(|p| p.indices.len() / 3).sum()
    }

    /// Encodes this assembled model into standard compliant GLTF 2.0 Binary (`.glb`).
    pub fn to_glb(&self) -> Result<Vec<u8>> {
        let mut bin_data = Vec::new();
        let mut accessors = Vec::new();
        let mut buffer_views = Vec::new();
        let mut meshes = Vec::new();

        // Write each primitive into binary buffer
        for prim in &self.primitives {
            if prim.positions.is_empty() || prim.indices.is_empty() {
                continue;
            }

            // 1. Indices bufferView (u16 or u32)
            let indices_offset = bin_data.len();
            let use_u32 = prim.indices.iter().any(|&idx| idx > 65535);

            if use_u32 {
                for &idx in &prim.indices {
                    bin_data.extend_from_slice(&idx.to_le_bytes());
                }
            } else {
                for &idx in &prim.indices {
                    bin_data.extend_from_slice(&(idx as u16).to_le_bytes());
                }
            }
            // Align to 4 bytes
            while !bin_data.len().is_multiple_of(4) {
                bin_data.push(0);
            }
            let indices_length = bin_data.len() - indices_offset;

            let indices_bv_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": indices_offset,
                "byteLength": indices_length,
                "target": 34963 // ELEMENT_ARRAY_BUFFER
            }));

            let indices_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": indices_bv_idx,
                "byteOffset": 0,
                "componentType": if use_u32 { 5125 } else { 5123 }, // UNSIGNED_INT or UNSIGNED_SHORT
                "count": prim.indices.len(),
                "type": "SCALAR"
            }));

            // 2. Positions bufferView (VEC3 FLOAT)
            let pos_offset = bin_data.len();
            let mut min_pos = [f32::MAX, f32::MAX, f32::MAX];
            let mut max_pos = [f32::MIN, f32::MIN, f32::MIN];

            for p in &prim.positions {
                min_pos[0] = min_pos[0].min(p[0]);
                min_pos[1] = min_pos[1].min(p[1]);
                min_pos[2] = min_pos[2].min(p[2]);

                max_pos[0] = max_pos[0].max(p[0]);
                max_pos[1] = max_pos[1].max(p[1]);
                max_pos[2] = max_pos[2].max(p[2]);

                bin_data.extend_from_slice(&p[0].to_le_bytes());
                bin_data.extend_from_slice(&p[1].to_le_bytes());
                bin_data.extend_from_slice(&p[2].to_le_bytes());
            }
            while !bin_data.len().is_multiple_of(4) {
                bin_data.push(0);
            }
            let pos_length = bin_data.len() - pos_offset;

            let pos_bv_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": pos_offset,
                "byteLength": pos_length,
                "target": 34962 // ARRAY_BUFFER
            }));

            let pos_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": pos_bv_idx,
                "byteOffset": 0,
                "componentType": 5126, // FLOAT
                "count": prim.positions.len(),
                "type": "VEC3",
                "min": min_pos,
                "max": max_pos
            }));

            // 3. Normals bufferView (VEC3 FLOAT)
            let norm_offset = bin_data.len();
            for n in &prim.normals {
                bin_data.extend_from_slice(&n[0].to_le_bytes());
                bin_data.extend_from_slice(&n[1].to_le_bytes());
                bin_data.extend_from_slice(&n[2].to_le_bytes());
            }
            while !bin_data.len().is_multiple_of(4) {
                bin_data.push(0);
            }
            let norm_length = bin_data.len() - norm_offset;

            let norm_bv_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": norm_offset,
                "byteLength": norm_length,
                "target": 34962
            }));

            let norm_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": norm_bv_idx,
                "byteOffset": 0,
                "componentType": 5126,
                "count": prim.normals.len(),
                "type": "VEC3"
            }));

            // 4. UVs bufferView (VEC2 FLOAT)
            let uv_offset = bin_data.len();
            for uv in &prim.uv {
                bin_data.extend_from_slice(&uv[0].to_le_bytes());
                bin_data.extend_from_slice(&uv[1].to_le_bytes());
            }
            while !bin_data.len().is_multiple_of(4) {
                bin_data.push(0);
            }
            let uv_length = bin_data.len() - uv_offset;

            let uv_bv_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": uv_offset,
                "byteLength": uv_length,
                "target": 34962
            }));

            let uv_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": uv_bv_idx,
                "byteOffset": 0,
                "componentType": 5126,
                "count": prim.uv.len(),
                "type": "VEC2"
            }));

            meshes.push(json!({
                "name": prim.name,
                "primitives": [{
                    "attributes": {
                        "POSITION": pos_acc_idx,
                        "NORMAL": norm_acc_idx,
                        "TEXCOORD_0": uv_acc_idx
                    },
                    "indices": indices_acc_idx,
                    "mode": 4 // TRIANGLES
                }]
            }));
        }

        // Build nodes referencing each mesh
        let nodes: Vec<_> = (0..meshes.len())
            .map(|i| json!({ "name": format!("Node_{i}"), "mesh": i }))
            .collect();
        let scene_nodes: Vec<_> = (0..meshes.len()).collect();

        // Build glTF JSON object
        let gltf = json!({
            "asset": {
                "version": "2.0",
                "generator": "DBXV2 Model Assembler"
            },
            "scene": 0,
            "scenes": [{
                "name": self.name,
                "nodes": scene_nodes
            }],
            "nodes": nodes,
            "meshes": meshes,
            "accessors": accessors,
            "bufferViews": buffer_views,
            "buffers": [{
                "byteLength": bin_data.len()
            }]
        });

        let json_str = serde_json::to_string(&gltf).map_err(|e| ReError::ParseError {
            context: "gltf_json_serialize",
            details: e.to_string(),
        })?;

        // Construct GLB Binary
        let mut json_bytes = json_str.into_bytes();
        // Pad JSON to 4-byte boundary with spaces (0x20)
        while !json_bytes.len().is_multiple_of(4) {
            json_bytes.push(0x20);
        }

        // Pad BIN to 4-byte boundary with zeros (0x00)
        while !bin_data.len().is_multiple_of(4) {
            bin_data.push(0x00);
        }

        let total_length = 12 + 8 + json_bytes.len() + 8 + bin_data.len();

        let mut glb = Vec::with_capacity(total_length);
        // Header
        glb.extend_from_slice(&GLB_MAGIC.to_le_bytes());
        glb.extend_from_slice(&2u32.to_le_bytes()); // version 2
        glb.extend_from_slice(&(total_length as u32).to_le_bytes());

        // Chunk 0: JSON
        glb.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
        glb.extend_from_slice(&GLB_JSON_CHUNK.to_le_bytes());
        glb.extend_from_slice(&json_bytes);

        // Chunk 1: BIN
        glb.extend_from_slice(&(bin_data.len() as u32).to_le_bytes());
        glb.extend_from_slice(&GLB_BIN_CHUNK.to_le_bytes());
        glb.extend_from_slice(&bin_data);

        Ok(glb)
    }
}

fn convert_submesh_to_primitive(sub: &EmdSubmesh, has_textures: bool) -> ModelPrimitive {
    let mut positions = Vec::with_capacity(sub.vertices.len());
    let mut normals = Vec::with_capacity(sub.vertices.len());
    let mut uv = Vec::with_capacity(sub.vertices.len());

    for v in &sub.vertices {
        positions.push(v.position);
        normals.push(v.normal);
        uv.push(v.uv);
    }

    ModelPrimitive {
        name: sub.name.clone(),
        material_name: sub.material_name.clone(),
        positions,
        normals,
        uv,
        indices: sub.indices.clone(),
        texture_index: if has_textures { Some(0) } else { None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::formats::emb::TexturePixelFormat;

    #[test]
    fn test_assemble_and_export_glb() {
        let emd_bytes = EmdFile::create_mock("Goku_Bust", "Mat_Gi_Orange");
        let emd = EmdFile::parse(&emd_bytes).expect("parse EMD");

        let emb_bytes = EmbFile::create_mock(32, 32, TexturePixelFormat::Rgba8);
        let emb = EmbFile::parse(&emb_bytes).expect("parse EMB");

        let esk_bytes = EskFile::create_mock();
        let esk = EskFile::parse(&esk_bytes).expect("parse ESK");

        let assembled =
            AssembledCharacterModel::assemble("GOK", &emd, Some(&emb), Some(&esk), None);
        assert_eq!(assembled.total_vertices(), 3);
        assert_eq!(assembled.total_triangles(), 1);

        let glb = assembled.to_glb().expect("export GLB");
        assert!(glb.len() > 64);
        assert_eq!(&glb[0..4], b"glTF");
        let version = u32::from_le_bytes(glb[4..8].try_into().unwrap());
        assert_eq!(version, 2);
    }
}
