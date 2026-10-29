// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 (DBXV2) object (`.emo`) parser.
//!
//! An `.emo` file groups named parts, each made of `#EMG` meshes, with a node tree that
//! places the parts. The game mostly uses it for skill and stage effect props, animated by
//! sibling `.obj.ema` (nodes), `.mat.ema` (materials) and `.light.ema` files. Layout
//! established on real CPK files and matching `EmObjectManager::CreateObject` and
//! `EmObjectShared::CalcHeapSize` in `xgcore.dll`.
//!
//! Layout (little-endian). Header: `#EMO`, `u16 0xFFFE`, `u16 header_size`, `u32 version`,
//! `u32 parts`, `u32 skeleton`, `u32 vertex_data`. Parts group (offsets relative to it):
//! `u16 part_count, u16, u32 names, u32 part_offsets[part_count]`; the names table holds one
//! `u32` string offset per part. Part (relative to it): `u16 emg_count, u16,
//! u32 emg_offsets[emg_count]`. EMG: `#EMG`, `u16, u16 mesh_count, u32 mesh_offsets[]`
//! (relative to the EMG). Mesh (relative to it): `u32 vertex_flags, u32 texture_list_count,
//! u32, u32 texture_lists, u16 vertex_count, u16 vertex_size, u32 vertices, u16,
//! u16 submesh_count, u32 submeshes`, then a 48-byte AABB (center, min, max as vec4). A
//! texture list is `u16 sampler_count, u16` then 12-byte samplers as in `.emd`; both tables
//! hold `u32` offsets relative to the mesh. Submesh: `vec4`, `u16 texture_list,
//! u16 index_count, u16 bone_count, char name[32], u16 indices[], u16 bones[]`. Vertices
//! use the `.emd` attribute layout.
//!
//! The node tree ([`parse_node_skeleton`], also embedded in `.ema`) is: `u16 node_count, u16,
//! u32, u32 nodes, u32 names, u32, u32, u32 node_extras, u32 ik, ..., u64 skeleton_id` at
//! `0x38`; each node is 80 bytes, `i16 parent, i16 child, i16 sibling, i16 part, i16`, padding
//! to 16, then a row-major 4x4 transform.

use crate::game::error::{ReError, Result};
use crate::game::formats::emd::EmdVertex;
use serde::{Deserialize, Serialize};

/// Signature magic for DBXV2 EMO files (`#EMO`).
pub const EMO_MAGIC: &[u8; 4] = b"#EMO";
/// Signature magic of the embedded mesh groups (`#EMG`).
pub const EMG_MAGIC: &[u8; 4] = b"#EMG";

const MAX_COUNT: usize = 4096;
const NODE_SIZE: usize = 80;

pub const FLAG_POSITION: u32 = 0x1;
pub const FLAG_NORMAL: u32 = 0x2;
pub const FLAG_UV: u32 = 0x4;
pub const FLAG_UV2: u32 = 0x8;
pub const FLAG_COLOR: u32 = 0x40;
pub const FLAG_TANGENT: u32 = 0x80;
pub const FLAG_BLEND: u32 = 0x200;
pub const FLAG_COMPRESSED: u32 = 0x8000;

/// A texture sampler of a texture list (12 bytes, same layout as `.emd`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EmgSampler {
    pub texture_index: u8,
    pub addressing: u8,
    pub filtering: u8,
    pub scale: [f32; 2],
}

pub(crate) fn u16_at(buffer: &[u8], offset: usize) -> Result<u16> {
    buffer
        .get(offset..offset + 2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .ok_or(ReError::BufferTooSmall {
            required: offset + 2,
            available: buffer.len(),
        })
}

pub(crate) fn u32_at(buffer: &[u8], offset: usize) -> Result<u32> {
    buffer
        .get(offset..offset + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or(ReError::BufferTooSmall {
            required: offset + 4,
            available: buffer.len(),
        })
}

pub(crate) fn f32_at(buffer: &[u8], offset: usize) -> Result<f32> {
    u32_at(buffer, offset).map(f32::from_bits)
}

pub(crate) fn f16_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exponent = i32::from((bits >> 10) & 0x1F);
    let mantissa = f32::from(bits & 0x3FF);
    sign * match exponent {
        0 => mantissa * 2f32.powi(-24),
        31 if mantissa == 0.0 => f32::INFINITY,
        31 => f32::NAN,
        e => (1.0 + mantissa / 1024.0) * 2f32.powi(e - 15),
    }
}

pub(crate) fn c_string_at(buffer: &[u8], offset: usize) -> Result<String> {
    let tail = buffer.get(offset..).ok_or(ReError::BufferTooSmall {
        required: offset,
        available: buffer.len(),
    })?;
    let end = tail.iter().position(|&b| b == 0).unwrap_or(tail.len());
    Ok(String::from_utf8_lossy(&tail[..end]).into_owned())
}

/// Byte size of one vertex for `flags`, as the game lays it out.
pub fn vertex_size(flags: u32) -> usize {
    let compressed = flags & FLAG_COMPRESSED != 0;
    let wide = |half: usize, full: usize| if compressed { half } else { full };
    let mut size = 0;
    if flags & FLAG_POSITION != 0 {
        size += 12;
    }
    for flag in [FLAG_NORMAL, FLAG_TANGENT] {
        if flags & flag != 0 {
            size += wide(8, 12);
        }
    }
    for flag in [FLAG_UV, FLAG_UV2] {
        if flags & flag != 0 {
            size += wide(4, 8);
        }
    }
    if flags & FLAG_COLOR != 0 {
        size += 4;
    }
    if flags & FLAG_BLEND != 0 {
        size += 4 + wide(8, 12);
    }
    size
}

/// Reads one vertex: position (3 × f32), normal, tangent, uv, uv2, color (4 × u8), blend
/// indices (4 × u8) and three weights, half precision when [`FLAG_COMPRESSED`] is set.
pub(crate) fn read_vertex(buffer: &[u8], at: usize, flags: u32) -> Result<EmdVertex> {
    let compressed = flags & FLAG_COMPRESSED != 0;
    let mut cursor = at;
    let mut floats = |n: usize, half: bool| -> Result<[f32; 4]> {
        let mut out = [0.0; 4];
        for (k, slot) in out.iter_mut().enumerate().take(n) {
            *slot = if half {
                f16_to_f32(u16_at(buffer, cursor + k * 2)?)
            } else {
                f32_at(buffer, cursor + k * 4)?
            };
        }
        cursor += if half {
            n.next_multiple_of(2) * 2
        } else {
            n * 4
        };
        Ok(out)
    };
    let mut vertex = EmdVertex::default();
    if flags & FLAG_POSITION != 0 {
        let p = floats(3, false)?;
        vertex.position = [p[0], p[1], p[2]];
    }
    if flags & FLAG_NORMAL != 0 {
        let n = floats(if compressed { 4 } else { 3 }, compressed)?;
        vertex.normal = [n[0], n[1], n[2]];
    }
    if flags & FLAG_TANGENT != 0 {
        vertex.tangent = Some(floats(if compressed { 4 } else { 3 }, compressed)?);
    }
    if flags & FLAG_UV != 0 {
        let uv = floats(2, compressed)?;
        vertex.uv = [uv[0], uv[1]];
    }
    if flags & FLAG_UV2 != 0 {
        floats(2, compressed)?;
    }
    let bytes4 = |at: usize| -> Result<[u8; 4]> {
        buffer
            .get(at..at + 4)
            .map(|b| [b[0], b[1], b[2], b[3]])
            .ok_or(ReError::BufferTooSmall {
                required: at + 4,
                available: buffer.len(),
            })
    };
    if flags & FLAG_COLOR != 0 {
        vertex.color = Some(bytes4(cursor)?.map(|c| f32::from(c) / 255.0));
        cursor += 4;
    }
    if flags & FLAG_BLEND != 0 {
        vertex.bone_indices = Some(bytes4(cursor)?.map(u16::from));
        cursor += 4;
        let mut w = [0.0; 3];
        for (k, slot) in w.iter_mut().enumerate() {
            *slot = if compressed {
                f16_to_f32(u16_at(buffer, cursor + k * 2)?)
            } else {
                f32_at(buffer, cursor + k * 4)?
            };
        }
        vertex.bone_weights = Some([w[0], w[1], w[2], (1.0 - w[0] - w[1] - w[2]).max(0.0)]);
    }
    Ok(vertex)
}

/// One submesh: a triangle list drawn with one texture list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmgSubmesh {
    /// Also the name of the EMM material.
    pub name: String,
    pub texture_list: usize,
    pub indices: Vec<u32>,
    /// Bone palette addressed by vertex blend indices.
    pub bones: Vec<u16>,
}

/// One EMG mesh: a vertex buffer shared by its submeshes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmgMesh {
    pub vertex_flags: u32,
    pub vertices: Vec<EmdVertex>,
    pub texture_lists: Vec<Vec<EmgSampler>>,
    pub submeshes: Vec<EmgSubmesh>,
    pub aabb_min: [f32; 3],
    pub aabb_max: [f32; 3],
}

/// A named part, placed by the node whose `part` points at it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmoPart {
    pub name: String,
    pub meshes: Vec<EmgMesh>,
}

/// A node of the object tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmoNode {
    pub name: String,
    pub parent: Option<usize>,
    pub child: Option<usize>,
    pub sibling: Option<usize>,
    /// Index of the part this node places, if any.
    pub part: Option<usize>,
    /// Row-major transform; translation in the last row.
    pub transform: [[f32; 4]; 4],
}

/// A parsed `.emo` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmoFile {
    pub version: u32,
    pub parts: Vec<EmoPart>,
    pub nodes: Vec<EmoNode>,
    pub skeleton_id: u64,
}

fn err(details: String) -> ReError {
    ReError::ParseError {
        context: "emo",
        details,
    }
}

fn index(value: u16, count: usize, what: &str) -> Result<Option<usize>> {
    if value == u16::MAX {
        return Ok(None);
    }
    let value = value as usize;
    if value >= count {
        return Err(err(format!("{what} {value} out of {count}")));
    }
    Ok(Some(value))
}

fn count_at(buffer: &[u8], at: usize, what: &str) -> Result<usize> {
    let count = u16_at(buffer, at)? as usize;
    if count > MAX_COUNT {
        return Err(err(format!("{count} {what}")));
    }
    Ok(count)
}

/// Parses the node tree at `base`, shared by `.emo` and `.ema`. `part_count` bounds the
/// node part indices (`usize::MAX` to skip the check).
pub(crate) fn parse_node_skeleton(
    buffer: &[u8],
    base: usize,
    part_count: usize,
) -> Result<(Vec<EmoNode>, u64)> {
    let count = count_at(buffer, base, "nodes")?;
    let nodes_at = base + u32_at(buffer, base + 8)? as usize;
    let names_at = base + u32_at(buffer, base + 12)? as usize;
    let id = buffer
        .get(base + 0x38..base + 0x40)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap_or_default()))
        .ok_or(ReError::BufferTooSmall {
            required: base + 0x40,
            available: buffer.len(),
        })?;
    let mut nodes = Vec::with_capacity(count);
    for i in 0..count {
        let at = nodes_at + i * NODE_SIZE;
        let name = c_string_at(buffer, base + u32_at(buffer, names_at + i * 4)? as usize)?;
        let mut transform = [[0.0; 4]; 4];
        for (row, values) in transform.iter_mut().enumerate() {
            for (col, value) in values.iter_mut().enumerate() {
                *value = f32_at(buffer, at + 16 + (row * 4 + col) * 4)?;
            }
        }
        nodes.push(EmoNode {
            name,
            parent: index(u16_at(buffer, at)?, count, "parent")?,
            child: index(u16_at(buffer, at + 2)?, count, "child")?,
            sibling: index(u16_at(buffer, at + 4)?, count, "sibling")?,
            part: index(u16_at(buffer, at + 6)?, part_count, "part")?,
            transform,
        });
    }
    Ok((nodes, id))
}

fn parse_mesh(buffer: &[u8], at: usize) -> Result<EmgMesh> {
    let flags = u32_at(buffer, at)?;
    let list_count = u32_at(buffer, at + 4)? as usize;
    let lists_at = at + u32_at(buffer, at + 0x0C)? as usize;
    let vertex_count = u16_at(buffer, at + 0x10)? as usize;
    let size = u16_at(buffer, at + 0x12)? as usize;
    let vertices_at = at + u32_at(buffer, at + 0x14)? as usize;
    let submesh_count = count_at(buffer, at + 0x1A, "submeshes")?;
    let submeshes_at = at + u32_at(buffer, at + 0x1C)? as usize;
    if size != vertex_size(flags) {
        return Err(err(format!("vertex size {size} for flags {flags:#x}")));
    }
    if list_count > MAX_COUNT {
        return Err(err(format!("{list_count} texture lists")));
    }
    let v = |k: usize| f32_at(buffer, at + 0x20 + k * 4);
    let (aabb_min, aabb_max) = ([v(4)?, v(5)?, v(6)?], [v(8)?, v(9)?, v(10)?]);
    let vertices = (0..vertex_count)
        .map(|i| read_vertex(buffer, vertices_at + i * size, flags))
        .collect::<Result<Vec<_>>>()?;
    let texture_lists = (0..list_count)
        .map(|l| {
            let list = at + u32_at(buffer, lists_at + l * 4)? as usize;
            let samplers = count_at(buffer, list, "samplers")?;
            (0..samplers)
                .map(|s| {
                    let o = list + 4 + s * 12;
                    let byte = |k| buffer.get(o + k).copied().unwrap_or(0);
                    Ok(EmgSampler {
                        texture_index: byte(1),
                        addressing: byte(2),
                        filtering: byte(3),
                        scale: [f32_at(buffer, o + 4)?, f32_at(buffer, o + 8)?],
                    })
                })
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>()?;
    let submeshes = (0..submesh_count)
        .map(|s| {
            let sub = at + u32_at(buffer, submeshes_at + s * 4)? as usize;
            let texture_list = u16_at(buffer, sub + 0x10)? as usize;
            let index_count = u16_at(buffer, sub + 0x12)? as usize;
            let bone_count = u16_at(buffer, sub + 0x14)? as usize;
            let name_bytes = buffer
                .get(sub + 0x16..sub + 0x36)
                .ok_or(ReError::BufferTooSmall {
                    required: sub + 0x36,
                    available: buffer.len(),
                })?;
            let end = name_bytes
                .iter()
                .position(|&b| b == 0)
                .unwrap_or(name_bytes.len());
            let name = String::from_utf8_lossy(&name_bytes[..end]).into_owned();
            let indices = (0..index_count)
                .map(|k| {
                    let i = u16_at(buffer, sub + 0x36 + k * 2)? as u32;
                    if i as usize >= vertex_count {
                        return Err(err(format!("{name}: index {i} of {vertex_count}")));
                    }
                    Ok(i)
                })
                .collect::<Result<Vec<_>>>()?;
            let bones_at = sub + 0x36 + index_count * 2;
            let bones = (0..bone_count)
                .map(|k| u16_at(buffer, bones_at + k * 2))
                .collect::<Result<Vec<_>>>()?;
            if list_count > 0 && texture_list >= list_count {
                return Err(err(format!(
                    "{name}: texture list {texture_list} of {list_count}"
                )));
            }
            Ok(EmgSubmesh {
                name,
                texture_list,
                indices,
                bones,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(EmgMesh {
        vertex_flags: flags,
        vertices,
        texture_lists,
        submeshes,
        aabb_min,
        aabb_max,
    })
}

fn parse_emg(buffer: &[u8], at: usize) -> Result<Vec<EmgMesh>> {
    if buffer.get(at..at + 4) != Some(EMG_MAGIC) {
        return Err(err(format!("missing #EMG at {at:#x}")));
    }
    let count = count_at(buffer, at + 6, "meshes")?;
    (0..count)
        .map(|m| parse_mesh(buffer, at + u32_at(buffer, at + 8 + m * 4)? as usize))
        .collect()
}

impl EmoFile {
    /// Every submesh of every part.
    pub fn submeshes(&self) -> impl Iterator<Item = &EmgSubmesh> {
        self.parts
            .iter()
            .flat_map(|p| &p.meshes)
            .flat_map(|m| &m.submeshes)
    }

    pub fn total_triangles(&self) -> usize {
        self.submeshes().map(|s| s.indices.len() / 3).sum()
    }

    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 0x20 {
            return Err(ReError::BufferTooSmall {
                required: 0x20,
                available: buffer.len(),
            });
        }
        if &buffer[..4] != EMO_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: EMO_MAGIC.to_vec(),
                found: buffer[..4].to_vec(),
            });
        }
        let version = u32_at(buffer, 8)?;
        let group = u32_at(buffer, 0x0C)? as usize;
        let skeleton = u32_at(buffer, 0x10)? as usize;
        let part_count = count_at(buffer, group, "parts")?;
        let names_at = group + u32_at(buffer, group + 4)? as usize;
        let parts = (0..part_count)
            .map(|p| {
                let name = c_string_at(buffer, group + u32_at(buffer, names_at + p * 4)? as usize)?;
                let offset = u32_at(buffer, group + 8 + p * 4)? as usize;
                let mut meshes = Vec::new();
                if offset != 0 {
                    let part = group + offset;
                    let emgs = count_at(buffer, part, "EMGs")?;
                    for e in 0..emgs {
                        let emg = u32_at(buffer, part + 4 + e * 4)? as usize;
                        if emg != 0 {
                            meshes.extend(parse_emg(buffer, part + emg)?);
                        }
                    }
                }
                Ok(EmoPart { name, meshes })
            })
            .collect::<Result<Vec<_>>>()?;
        let (nodes, skeleton_id) = if skeleton == 0 {
            (Vec::new(), 0)
        } else {
            parse_node_skeleton(buffer, skeleton, part_count)?
        };
        Ok(Self {
            version,
            parts,
            nodes,
            skeleton_id,
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn put(out: &mut Vec<u8>, at: usize, bytes: &[u8]) {
        if out.len() < at + bytes.len() {
            out.resize(at + bytes.len(), 0);
        }
        out[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn le16(v: u16) -> [u8; 2] {
        v.to_le_bytes()
    }

    fn le32(v: u32) -> [u8; 4] {
        v.to_le_bytes()
    }

    /// Writes the node tree used by `.emo` and `.ema` at `base`: a root and one child that
    /// places part 0 at `translation`.
    pub(crate) fn put_skeleton(out: &mut Vec<u8>, base: usize, translation: [f32; 3]) {
        put(out, base, &le16(2));
        put(out, base + 8, &le32(0x40));
        put(out, base + 12, &le32(0x40 + 2 * 80));
        put(out, base + 0x38, &0x1234_5678_9abc_def0u64.to_le_bytes());
        for (i, links) in [
            [u16::MAX, 1, u16::MAX, u16::MAX],
            [0, u16::MAX, u16::MAX, 0],
        ]
        .iter()
        .enumerate()
        {
            let node = base + 0x40 + i * 80;
            for (k, link) in links.iter().enumerate() {
                put(out, node + k * 2, &le16(*link));
            }
            put(out, node + 8, &le16(u16::MAX));
            for d in 0..4 {
                put(out, node + 16 + (d * 4 + d) * 4, &1f32.to_le_bytes());
            }
            if i == 1 {
                for (k, t) in translation.iter().enumerate() {
                    put(out, node + 16 + (12 + k) * 4, &t.to_le_bytes());
                }
            }
        }
        let names = base + 0x40 + 2 * 80;
        put(out, names, &le32((names + 8 - base) as u32));
        put(out, names + 4, &le32((names + 13 - base) as u32));
        put(out, names + 8, b"Root\0Leaf\0");
    }

    /// One part (`Cor`) with one triangle, three uncompressed position-only vertices.
    fn encode_triangle() -> Vec<u8> {
        let mut out = Vec::new();
        put(&mut out, 0, b"#EMO");
        put(&mut out, 4, &[0xFE, 0xFF, 0x20, 0]);
        put(&mut out, 8, &le32(0x92c0));
        put(&mut out, 0x0C, &le32(0x20));
        let group = 0x20;
        put(&mut out, group, &[1, 0, 1, 0]);
        put(&mut out, group + 4, &le32(0x200));
        put(&mut out, group + 8, &le32(0x10));
        put(&mut out, group + 0x200, &le32(0x204));
        put(&mut out, group + 0x204, b"Cor\0");
        let part = group + 0x10;
        put(&mut out, part, &[1, 0, 0, 0]);
        put(&mut out, part + 4, &le32(0x10));
        let emg = part + 0x10;
        put(&mut out, emg, b"#EMG");
        put(&mut out, emg + 6, &le16(1));
        put(&mut out, emg + 8, &le32(0x10));
        let mesh = emg + 0x10;
        put(&mut out, mesh, &le32(1));
        put(&mut out, mesh + 4, &le32(1));
        put(&mut out, mesh + 0x0C, &le32(0x50));
        put(&mut out, mesh + 0x10, &le16(3));
        put(&mut out, mesh + 0x12, &le16(12));
        put(&mut out, mesh + 0x14, &le32(0xC0));
        put(&mut out, mesh + 0x1A, &le16(1));
        put(&mut out, mesh + 0x1C, &le32(0x64));
        put(&mut out, mesh + 0x50, &le32(0x54));
        put(&mut out, mesh + 0x54, &le16(1));
        put(&mut out, mesh + 0x58, &[0, 0, 0, 0x22]);
        put(&mut out, mesh + 0x5C, &1f32.to_le_bytes());
        put(&mut out, mesh + 0x60, &1f32.to_le_bytes());
        put(&mut out, mesh + 0x64, &le32(0x70));
        let sub = mesh + 0x70;
        put(&mut out, sub + 0x12, &le16(3));
        put(&mut out, sub + 0x16, b"Cor\0");
        for (k, i) in [0u16, 2, 1].iter().enumerate() {
            put(&mut out, sub + 0x36 + k * 2, &le16(*i));
        }
        let vertices = mesh + 0xC0;
        for (k, p) in [[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]]
            .iter()
            .enumerate()
        {
            for (c, value) in p.iter().enumerate() {
                put(&mut out, vertices + k * 12 + c * 4, &value.to_le_bytes());
            }
        }
        let skeleton = out.len().next_multiple_of(16);
        put(&mut out, 0x10, &le32(skeleton as u32));
        put_skeleton(&mut out, skeleton, [0.0, 2.0, 0.0]);
        out
    }

    #[test]
    fn parses_encoded_object() {
        let emo = EmoFile::parse(&encode_triangle()).unwrap();
        assert_eq!(emo.version, 0x92c0);
        assert_eq!(emo.parts.len(), 1);
        assert_eq!(emo.parts[0].name, "Cor");
        let mesh = &emo.parts[0].meshes[0];
        assert_eq!(mesh.vertices[1].position, [1.0, 0.0, 0.0]);
        assert_eq!(mesh.texture_lists[0][0].scale, [1.0, 1.0]);
        assert_eq!(mesh.submeshes[0].name, "Cor");
        assert_eq!(mesh.submeshes[0].indices, [0, 2, 1]);
        assert_eq!(emo.total_triangles(), 1);
        assert_eq!(emo.nodes.len(), 2);
        assert_eq!(emo.nodes[1].name, "Leaf");
        assert_eq!(emo.nodes[1].parent, Some(0));
        assert_eq!(emo.nodes[0].child, Some(1));
        assert_eq!(emo.nodes[1].part, Some(0));
        assert_eq!(emo.nodes[1].transform[3], [0.0, 2.0, 0.0, 1.0]);
        assert_eq!(emo.skeleton_id, 0x1234_5678_9abc_def0);
    }

    #[test]
    fn rejects_out_of_range_index() {
        let mut bytes = encode_triangle();
        let sub = 0x20 + 0x10 + 0x10 + 0x10 + 0x70;
        bytes[sub + 0x36..sub + 0x38].copy_from_slice(&le16(7));
        assert!(EmoFile::parse(&bytes).is_err());
        assert!(EmoFile::parse(b"#EMD\xfe\xff").is_err());
    }

    /// `DBXV2_REAL_EMO_DIR`: every `.emo` below it must parse into sane geometry.
    #[test]
    fn parses_real_objects_when_provided() {
        let Ok(dir) = std::env::var("DBXV2_REAL_EMO_DIR") else {
            return;
        };
        let mut files = Vec::new();
        let mut stack = vec![std::path::PathBuf::from(dir)];
        while let Some(path) = stack.pop() {
            for entry in std::fs::read_dir(path).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("emo"))
                {
                    files.push(path);
                }
            }
        }
        assert!(!files.is_empty());
        for path in &files {
            let emo = EmoFile::parse(&std::fs::read(path).unwrap())
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            for mesh in emo.parts.iter().flat_map(|p| &p.meshes) {
                for v in &mesh.vertices {
                    assert!(
                        v.position.iter().all(|c| c.is_finite()),
                        "{}",
                        path.display()
                    );
                }
            }
            for node in &emo.nodes {
                assert!(node.transform.iter().flatten().all(|c| c.is_finite()));
            }
        }
        eprintln!("parsed {} real .emo files", files.len());
    }
}
