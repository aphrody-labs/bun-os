// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 (DBXV2) motion (`.ema`) parser.
//!
//! An `.ema` file animates an `.emo` object: its nodes (`*.obj.ema`), its materials
//! (`*.mat.ema`) or a light (`*.light.ema`). Layout established on real CPK files; the
//! header checks match `EmMotion::Create` in `xgcore.dll`.
//!
//! Layout (little-endian). Header: `#EMA`, `u16 0xFFFE`, `u16 header_size`, `u32 version`,
//! `u32 skeleton` (an `.emo` node tree, 0 when absent), `u16 animation_count`, `u16 kind`
//! ([`EmaKind`]), then `u32 animation_offsets[]` at `header_size`. Animation (offsets relative
//! to it): `u16 frame_count, u16 command_count, u32 value_count, u16, u16 value_flags,
//! u32 name, u32 values, u32 command_offsets[]`. The name record is 10 bytes then
//! `u8 length` and the characters. Values are `f16` when `value_flags & 1` (object and light
//! animations) and `f32` otherwise (material animations), as `EmMotion::GetTailTranslation`
//! branches on it. Command: `u16 node, u8 target, u8 flags,
//! u16 key_count, u16 indices` (relative to the command), then the key frames: `u8` each, or
//! `u16` when `flags & 0x20` (non-decreasing; a few material files repeat a frame); at `indices`, one `u16` value index per key (`u32` when
//! `flags & 0x40`, masked by `0x3FFF_FFFF`, used by motions with more than 16384 values). The top bits
//! of an index, when not zero, are the distance from the key value to its tangent value.
//! `flags & 3` is the animated component (x, y, z, w).

use crate::game::error::{ReError, Result};
use crate::game::formats::emo::{EmoNode, f16_to_f32, f32_at, parse_node_skeleton, u16_at, u32_at};
use serde::{Deserialize, Serialize};

/// Signature magic for DBXV2 EMA files (`#EMA`).
pub const EMA_MAGIC: &[u8; 4] = b"#EMA";

const MAX_COUNT: usize = 1 << 22;
const WIDE_FRAMES: u8 = 0x20;
const WIDE_INDICES: u8 = 0x40;

/// What the animations of a file drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmaKind {
    /// Node transforms: target 0 translation, 1 rotation (degrees), 2 scale.
    Object,
    /// Light parameters.
    Light,
    /// Material parameters (`MATERIAL_ANIMATION`).
    Material,
    Other(u16),
}

impl From<u16> for EmaKind {
    fn from(value: u16) -> Self {
        match value {
            3 => Self::Object,
            4 => Self::Light,
            8 => Self::Material,
            other => Self::Other(other),
        }
    }
}

/// One key: the value at `frame`, reached with `interpolation`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EmaKeyframe {
    pub frame: u16,
    pub value: f32,
    /// Index into the animation values.
    pub value_index: u32,
    /// Tangent of a curved key, stored after its value.
    pub tangent: Option<f32>,
}

/// The key frames of one component of one node (or material/light parameter).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmaCommand {
    pub node: u16,
    pub target: u8,
    pub component: u8,
    pub flags: u8,
    pub keyframes: Vec<EmaKeyframe>,
}

impl EmaCommand {
    /// Value at `frame`, linear between keys and held outside them.
    pub fn sample(&self, frame: f32) -> Option<f32> {
        let first = self.keyframes.first()?;
        if frame <= f32::from(first.frame) {
            return Some(first.value);
        }
        for pair in self.keyframes.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if frame <= f32::from(b.frame) {
                let t = (frame - f32::from(a.frame)) / f32::from(b.frame - a.frame).max(1.0);
                return Some(a.value + (b.value - a.value) * t);
            }
        }
        self.keyframes.last().map(|k| k.value)
    }
}

/// One named animation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmaAnimation {
    pub name: String,
    pub frame_count: u16,
    /// Values stored as `f16` (`f32` otherwise).
    pub half_values: bool,
    pub values: Vec<f32>,
    pub commands: Vec<EmaCommand>,
}

/// A parsed `.ema` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmaFile {
    pub version: u32,
    pub kind: EmaKind,
    pub animations: Vec<EmaAnimation>,
    /// Node tree the object animations address, when embedded.
    pub nodes: Vec<EmoNode>,
}

fn err(details: String) -> ReError {
    ReError::ParseError {
        context: "ema",
        details,
    }
}

fn parse_animation(buffer: &[u8], at: usize, node_count: usize) -> Result<EmaAnimation> {
    let frame_count = u16_at(buffer, at)?;
    let command_count = u16_at(buffer, at + 2)? as usize;
    let value_count = u32_at(buffer, at + 4)? as usize;
    let half_values = u16_at(buffer, at + 10)? & 1 != 0;
    let name_at = at + u32_at(buffer, at + 12)? as usize;
    let values_at = at + u32_at(buffer, at + 16)? as usize;
    if value_count > MAX_COUNT || command_count > MAX_COUNT {
        return Err(err(format!(
            "{command_count} commands, {value_count} values"
        )));
    }
    let length = *buffer.get(name_at + 10).ok_or(ReError::BufferTooSmall {
        required: name_at + 11,
        available: buffer.len(),
    })? as usize;
    let name = buffer
        .get(name_at + 11..name_at + 11 + length)
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .ok_or(ReError::BufferTooSmall {
            required: name_at + 11 + length,
            available: buffer.len(),
        })?;
    let values = (0..value_count)
        .map(|i| {
            if half_values {
                u16_at(buffer, values_at + i * 2).map(f16_to_f32)
            } else {
                f32_at(buffer, values_at + i * 4)
            }
        })
        .collect::<Result<Vec<_>>>()?;
    let commands = (0..command_count)
        .map(|c| {
            let cmd = at + u32_at(buffer, at + 20 + c * 4)? as usize;
            let node = u16_at(buffer, cmd)?;
            let target = *buffer.get(cmd + 2).unwrap_or(&0);
            let flags = *buffer.get(cmd + 3).unwrap_or(&0);
            let key_count = u16_at(buffer, cmd + 4)? as usize;
            let indices = cmd + u16_at(buffer, cmd + 6)? as usize;
            if node_count > 0 && node as usize >= node_count {
                return Err(err(format!("{name}: node {node} of {node_count}")));
            }
            let mut previous = None;
            let keyframes = (0..key_count)
                .map(|k| {
                    let frame = if flags & WIDE_FRAMES != 0 {
                        u16_at(buffer, cmd + 8 + k * 2)?
                    } else {
                        u16::from(*buffer.get(cmd + 8 + k).ok_or(ReError::BufferTooSmall {
                            required: cmd + 9 + k,
                            available: buffer.len(),
                        })?)
                    };
                    let (value_index, tangent_offset) = if flags & WIDE_INDICES != 0 {
                        let raw = u32_at(buffer, indices + k * 4)?;
                        (raw & 0x3FFF_FFFF, raw >> 30)
                    } else {
                        let raw = u16_at(buffer, indices + k * 2)?;
                        (u32::from(raw & 0x3FFF), u32::from(raw >> 14))
                    };
                    // Some material files repeat a key frame; only a decreasing frame is invalid.
                    if previous.is_some_and(|p| frame < p) || frame > frame_count {
                        return Err(err(format!("{name}: frame {frame} after {previous:?}")));
                    }
                    previous = Some(frame);
                    let value = *values.get(value_index as usize).ok_or_else(|| {
                        err(format!("{name}: value {value_index} of {value_count}"))
                    })?;
                    let tangent = match tangent_offset {
                        0 => None,
                        offset => {
                            Some(*values.get((value_index + offset) as usize).ok_or_else(|| {
                                err(format!(
                                    "{name}: tangent {value_index}+{offset} of {value_count}"
                                ))
                            })?)
                        }
                    };
                    Ok(EmaKeyframe {
                        frame,
                        value,
                        value_index,
                        tangent,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(EmaCommand {
                node,
                target,
                component: flags & 3,
                flags,
                keyframes,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(EmaAnimation {
        name,
        frame_count,
        half_values,
        values,
        commands,
    })
}

impl EmaFile {
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 0x20 {
            return Err(ReError::BufferTooSmall {
                required: 0x20,
                available: buffer.len(),
            });
        }
        if &buffer[..4] != EMA_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: EMA_MAGIC.to_vec(),
                found: buffer[..4].to_vec(),
            });
        }
        let header_size = u16_at(buffer, 6)? as usize;
        let version = u32_at(buffer, 8)?;
        let skeleton = u32_at(buffer, 0x0C)? as usize;
        let count = u16_at(buffer, 0x10)? as usize;
        let kind = EmaKind::from(u16_at(buffer, 0x12)?);
        let nodes = if skeleton == 0 {
            Vec::new()
        } else {
            parse_node_skeleton(buffer, skeleton, usize::MAX)?.0
        };
        let mut animations = Vec::with_capacity(count);
        for i in 0..count {
            let at = u32_at(buffer, header_size + i * 4)? as usize;
            if at != 0 {
                animations.push(parse_animation(buffer, at, nodes.len())?);
            }
        }
        Ok(Self {
            version,
            kind,
            animations,
            nodes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::formats::emo::tests::put_skeleton;

    fn put(out: &mut Vec<u8>, at: usize, bytes: &[u8]) {
        if out.len() < at + bytes.len() {
            out.resize(at + bytes.len(), 0);
        }
        out[at..at + bytes.len()].copy_from_slice(bytes);
    }

    /// One object animation: node 1 rises along y from 0 to 2 over 30 frames.
    fn encode_rise() -> Vec<u8> {
        let mut out = Vec::new();
        put(&mut out, 0, b"#EMA");
        put(&mut out, 4, &[0xFE, 0xFF, 0x20, 0]);
        put(&mut out, 8, &0x92c0u32.to_le_bytes());
        put(&mut out, 0x10, &1u16.to_le_bytes());
        put(&mut out, 0x12, &3u16.to_le_bytes());
        put(&mut out, 0x20, &0x24u32.to_le_bytes());
        let anim = 0x24;
        put(&mut out, anim, &30u16.to_le_bytes());
        put(&mut out, anim + 2, &1u16.to_le_bytes());
        put(&mut out, anim + 4, &3u32.to_le_bytes());
        put(&mut out, anim + 10, &1u16.to_le_bytes());
        put(&mut out, anim + 12, &0x40u32.to_le_bytes());
        put(&mut out, anim + 16, &0x30u32.to_le_bytes());
        put(&mut out, anim + 20, &0x18u32.to_le_bytes());
        let cmd = anim + 0x18;
        put(&mut out, cmd, &1u16.to_le_bytes());
        put(&mut out, cmd + 2, &[0, 1]);
        put(&mut out, cmd + 4, &2u16.to_le_bytes());
        put(&mut out, cmd + 6, &0x0Cu16.to_le_bytes());
        put(&mut out, cmd + 8, &[0, 30]);
        put(&mut out, cmd + 0x0C, &0u16.to_le_bytes());
        put(&mut out, cmd + 0x0E, &0x4001u16.to_le_bytes());
        put(&mut out, anim + 0x30, &[0x00, 0x00, 0x00, 0x40, 0x00, 0x3C]);
        put(&mut out, anim + 0x40 + 10, &[4]);
        put(&mut out, anim + 0x40 + 11, b"Rise");
        let skeleton = out.len().next_multiple_of(16);
        put(&mut out, 0x0C, &(skeleton as u32).to_le_bytes());
        put_skeleton(&mut out, skeleton, [0.0; 3]);
        out
    }

    #[test]
    fn parses_encoded_motion() {
        let ema = EmaFile::parse(&encode_rise()).unwrap();
        assert_eq!(ema.kind, EmaKind::Object);
        assert_eq!(ema.nodes.len(), 2);
        let anim = &ema.animations[0];
        assert_eq!(anim.name, "Rise");
        assert_eq!(anim.frame_count, 30);
        assert!(anim.half_values);
        assert_eq!(anim.values, [0.0, 2.0, 1.0]);
        let cmd = &anim.commands[0];
        assert_eq!((cmd.node, cmd.target, cmd.component), (1, 0, 1));
        assert_eq!(cmd.keyframes[0].tangent, None);
        assert_eq!(cmd.keyframes[1].tangent, Some(1.0));
        assert_eq!(cmd.sample(15.0), Some(1.0));
        assert_eq!(cmd.sample(40.0), Some(2.0));
    }

    #[test]
    fn rejects_out_of_range_value() {
        let mut bytes = encode_rise();
        let indices = 0x24 + 0x18 + 0x0C;
        bytes[indices..indices + 2].copy_from_slice(&9u16.to_le_bytes());
        assert!(EmaFile::parse(&bytes).is_err());
        assert!(EmaFile::parse(b"#EMO\xfe\xff").is_err());
    }

    /// `DBXV2_REAL_EMA_DIR`: every `.ema` below it must parse without NaN. Half-float
    /// infinities are real data (translations beyond 65504 in large cutscene motions).
    #[test]
    fn parses_real_motions_when_provided() {
        let Ok(dir) = std::env::var("DBXV2_REAL_EMA_DIR") else {
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
                    .is_some_and(|e| e.eq_ignore_ascii_case("ema"))
                {
                    files.push(path);
                }
            }
        }
        assert!(!files.is_empty());
        for path in &files {
            let ema = EmaFile::parse(&std::fs::read(path).unwrap())
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            for anim in &ema.animations {
                assert!(
                    !anim.values.iter().any(|v| v.is_nan()),
                    "{}",
                    path.display()
                );
            }
        }
        eprintln!("parsed {} real .ema files", files.len());
    }
}
