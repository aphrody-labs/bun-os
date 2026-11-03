// SPDX-License-Identifier: Apache-2.0
//! Skeletons, poses, automatic skin weights and linear-blend skinning.
//!
//! The data layout follows glTF 2.0 skins so a rig round-trips to the
//! renderer and to exporters without translation: bones are stored parent
//! first, each with a local rest [`Trs`]; the inverse bind matrix of a bone
//! is the inverse of its global rest matrix; a vertex carries up to four
//! `(joint, weight)` influences (`JOINTS_0` / `WEIGHTS_0`).
//!
//! Automatic weights use inverse-distance falloff to each bone segment
//! (head to tail), normalized over the four nearest bones. That is the
//! "envelope" family of binding; heat-diffusion (geodesic) weights are not
//! implemented.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::xform::{Trs, add, affine_inverse, dot, length, scale, sub};
use crate::math3d::{Mat4, Vec3};

/// Upper bound on bones per skeleton.
pub const MAX_BONES: usize = 256;
/// Influences per vertex (glTF `JOINTS_0`/`WEIGHTS_0`).
pub const MAX_INFLUENCES: usize = 4;

/// Why a rig operation was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RigError {
    /// The skeleton, pose or weights are malformed.
    Invalid(String),
}

impl std::fmt::Display for RigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(why) => write!(f, "invalid rig: {why}"),
        }
    }
}

impl std::error::Error for RigError {}

fn invalid(why: impl Into<String>) -> RigError {
    RigError::Invalid(why.into())
}

/// A bone segment `(head, tail)` in skeleton space.
pub type Segment = ([f32; 3], [f32; 3]);

/// Skinned positions and (when given) normals.
pub type Skinned = (Vec<[f32; 3]>, Option<Vec<[f32; 3]>>);

/// One bone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bone {
    /// Unique name.
    pub name: String,
    /// Parent index (always lower than this bone's index).
    #[serde(default)]
    pub parent: Option<usize>,
    /// Local rest transform relative to the parent.
    #[serde(default)]
    pub rest: Trs,
    /// Length along the bone's local +Y axis, used for display and for the
    /// tail of leaf bones in automatic weighting.
    #[serde(default = "default_length")]
    pub length: f32,
}

const fn default_length() -> f32 {
    0.25
}

/// A bone hierarchy, parents before children.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Skeleton {
    /// Bones.
    pub bones: Vec<Bone>,
}

/// Local transforms of every bone (same order as [`Skeleton::bones`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pose {
    /// Local transforms.
    pub locals: Vec<Trs>,
}

impl Pose {
    /// Per-bone blend of two poses of the same skeleton.
    ///
    /// # Errors
    /// [`RigError`] when the poses have different bone counts.
    pub fn blend(&self, other: &Self, t: f32) -> Result<Self, RigError> {
        if self.locals.len() != other.locals.len() {
            return Err(invalid("blended poses have different bone counts"));
        }
        Ok(Self {
            locals: self
                .locals
                .iter()
                .zip(&other.locals)
                .map(|(a, b)| a.blend(b, t.clamp(0.0, 1.0)))
                .collect(),
        })
    }
}

/// Per-vertex skin influences, glTF layout.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SkinWeights {
    /// Bone indices, four per vertex.
    pub joints: Vec<[u16; 4]>,
    /// Normalized weights, four per vertex.
    pub weights: Vec<[f32; 4]>,
}

impl Skeleton {
    /// Index of a bone by name.
    #[must_use]
    pub fn find(&self, name: &str) -> Option<usize> {
        self.bones.iter().position(|b| b.name == name)
    }

    /// Append a bone; returns its index.
    ///
    /// # Errors
    /// [`RigError`] for a duplicate name, unknown parent or too many bones.
    pub fn add_bone(
        &mut self,
        name: &str,
        parent: Option<&str>,
        rest: Trs,
        length: f32,
    ) -> Result<usize, RigError> {
        if self.find(name).is_some() {
            return Err(invalid(format!("duplicate bone {name:?}")));
        }
        let parent = match parent {
            Some(p) => Some(
                self.find(p)
                    .ok_or_else(|| invalid(format!("unknown parent bone {p:?}")))?,
            ),
            None => None,
        };
        self.bones.push(Bone {
            name: name.to_string(),
            parent,
            rest,
            length,
        });
        if let Err(e) = self.validate() {
            self.bones.pop();
            return Err(e);
        }
        Ok(self.bones.len() - 1)
    }

    /// Check ordering, names, finiteness and limits.
    ///
    /// # Errors
    /// [`RigError`] describing the first problem.
    pub fn validate(&self) -> Result<(), RigError> {
        if self.bones.len() > MAX_BONES {
            return Err(invalid(format!("more than {MAX_BONES} bones")));
        }
        let mut names = HashSet::new();
        for (i, b) in self.bones.iter().enumerate() {
            if b.name.is_empty() || !names.insert(b.name.as_str()) {
                return Err(invalid(format!("bone {i} has an empty or duplicate name")));
            }
            if let Some(p) = b.parent {
                if p >= i {
                    return Err(invalid(format!("bone {i} parent {p} is not before it")));
                }
            }
            if !b.rest.is_finite() || !(b.length.is_finite() && b.length >= 0.0) {
                return Err(invalid(format!("bone {i} has a non-finite transform")));
            }
        }
        Ok(())
    }

    /// The rest pose.
    #[must_use]
    pub fn rest_pose(&self) -> Pose {
        Pose {
            locals: self.bones.iter().map(|b| b.rest).collect(),
        }
    }

    /// Global matrices of a pose.
    ///
    /// # Errors
    /// [`RigError`] when the pose size does not match.
    pub fn globals(&self, pose: &Pose) -> Result<Vec<Mat4>, RigError> {
        if pose.locals.len() != self.bones.len() {
            return Err(invalid("pose bone count differs from skeleton"));
        }
        let mut out: Vec<Mat4> = Vec::with_capacity(self.bones.len());
        for (b, local) in self.bones.iter().zip(&pose.locals) {
            let m = local.matrix();
            out.push(match b.parent {
                Some(p) => out[p].mul(&m),
                None => m,
            });
        }
        Ok(out)
    }

    /// Inverse bind matrices (inverse global rest matrices).
    ///
    /// # Errors
    /// [`RigError`] for a singular rest transform.
    pub fn inverse_bind(&self) -> Result<Vec<Mat4>, RigError> {
        self.globals(&self.rest_pose())?
            .iter()
            .enumerate()
            .map(|(i, m)| affine_inverse(m).ok_or_else(|| invalid(format!("bone {i} is singular"))))
            .collect()
    }

    /// Skinning matrices `global(pose) * inverse_bind`.
    ///
    /// # Errors
    /// [`RigError`] for a mismatched pose or singular rest.
    pub fn skin_matrices(&self, pose: &Pose) -> Result<Vec<Mat4>, RigError> {
        let g = self.globals(pose)?;
        let ib = self.inverse_bind()?;
        Ok(g.iter().zip(&ib).map(|(g, ib)| g.mul(ib)).collect())
    }

    /// Rest-pose head and tail of every bone in skeleton space.
    ///
    /// # Errors
    /// [`RigError`] for a malformed skeleton.
    pub fn segments(&self) -> Result<Vec<Segment>, RigError> {
        let g = self.globals(&self.rest_pose())?;
        let heads: Vec<[f32; 3]> = g
            .iter()
            .map(|m| [m.cols[3][0], m.cols[3][1], m.cols[3][2]])
            .collect();
        Ok(self
            .bones
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let children: Vec<usize> = (0..self.bones.len())
                    .filter(|&c| self.bones[c].parent == Some(i))
                    .collect();
                let tail = if children.is_empty() {
                    g[i].transform_point(Vec3::new(0.0, b.length, 0.0))
                        .to_array()
                } else {
                    scale(
                        children.iter().fold([0.0; 3], |acc, &c| add(acc, heads[c])),
                        1.0 / children.len() as f32,
                    )
                };
                (heads[i], tail)
            })
            .collect())
    }

    /// Envelope-style automatic weights for `positions` (skeleton space).
    /// `power` sharpens the falloff (4 is a good default).
    ///
    /// # Errors
    /// [`RigError`] for an empty skeleton or invalid power.
    pub fn auto_weights(
        &self,
        positions: &[[f32; 3]],
        power: f32,
    ) -> Result<SkinWeights, RigError> {
        if self.bones.is_empty() {
            return Err(invalid("skeleton has no bones"));
        }
        if !(power > 0.0 && power.is_finite()) {
            return Err(invalid("weight power must be positive"));
        }
        self.validate()?;
        let segs = self.segments()?;
        let mut out = SkinWeights {
            joints: Vec::with_capacity(positions.len()),
            weights: Vec::with_capacity(positions.len()),
        };
        let mut scored: Vec<(f32, usize)> = Vec::with_capacity(segs.len());
        for &p in positions {
            scored.clear();
            for (i, &(h, t)) in segs.iter().enumerate() {
                let d = point_segment_distance(p, h, t).max(1e-4);
                scored.push((d.powf(-power), i));
            }
            scored.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
            let top = &scored[..scored.len().min(MAX_INFLUENCES)];
            let total: f32 = top.iter().map(|s| s.0).sum();
            let mut j = [0_u16; 4];
            let mut w = [0.0_f32; 4];
            for (k, &(s, i)) in top.iter().enumerate() {
                j[k] = i as u16;
                w[k] = s / total;
            }
            out.joints.push(j);
            out.weights.push(w);
        }
        Ok(out)
    }
}

/// Distance from `p` to the segment `a..b`.
#[must_use]
pub fn point_segment_distance(p: [f32; 3], a: [f32; 3], b: [f32; 3]) -> f32 {
    let ab = sub(b, a);
    let len2 = dot(ab, ab);
    let t = if len2 > 0.0 {
        (dot(sub(p, a), ab) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    length(sub(p, add(a, scale(ab, t))))
}

/// Linear-blend skinning of positions and normals.
///
/// # Errors
/// [`RigError`] when weights do not match the vertex count or reference a
/// missing bone.
pub fn skin(
    positions: &[[f32; 3]],
    normals: Option<&[[f32; 3]]>,
    weights: &SkinWeights,
    matrices: &[Mat4],
) -> Result<Skinned, RigError> {
    if weights.joints.len() != positions.len() || weights.weights.len() != positions.len() {
        return Err(invalid("skin weights do not match the vertex count"));
    }
    if normals.is_some_and(|n| n.len() != positions.len()) {
        return Err(invalid("normals do not match the vertex count"));
    }
    let mut out_p = Vec::with_capacity(positions.len());
    let mut out_n = normals.map(|n| Vec::with_capacity(n.len()));
    for (i, &p) in positions.iter().enumerate() {
        let mut acc_p = [0.0_f32; 3];
        let mut acc_n = [0.0_f32; 3];
        let mut total = 0.0;
        for k in 0..MAX_INFLUENCES {
            let w = weights.weights[i][k];
            if w <= 0.0 {
                continue;
            }
            let m = matrices
                .get(weights.joints[i][k] as usize)
                .ok_or_else(|| invalid(format!("vertex {i} references a missing bone")))?;
            total += w;
            acc_p = add(
                acc_p,
                scale(m.transform_point(Vec3::from_array(p)).to_array(), w),
            );
            if let Some(n) = normals {
                acc_n = add(
                    acc_n,
                    scale(m.transform_vector(Vec3::from_array(n[i])).to_array(), w),
                );
            }
        }
        if total <= 0.0 {
            out_p.push(p);
            if let (Some(on), Some(n)) = (out_n.as_mut(), normals) {
                on.push(n[i]);
            }
            continue;
        }
        out_p.push(scale(acc_p, 1.0 / total));
        if let Some(on) = out_n.as_mut() {
            on.push(super::xform::normalize(acc_n));
        }
    }
    Ok((out_p, out_n))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::author3d::xform::Quat;

    fn arm() -> Skeleton {
        let mut s = Skeleton::default();
        s.add_bone("root", None, Trs::IDENTITY, 1.0).unwrap();
        s.add_bone(
            "forearm",
            Some("root"),
            Trs {
                translation: [0.0, 1.0, 0.0],
                ..Trs::IDENTITY
            },
            1.0,
        )
        .unwrap();
        s
    }

    #[test]
    fn rest_pose_skinning_is_identity() {
        let s = arm();
        let pts = vec![[0.1, 0.2, 0.0], [0.0, 1.5, 0.1], [0.0, 1.9, -0.1]];
        let w = s.auto_weights(&pts, 4.0).unwrap();
        for ws in &w.weights {
            assert!((ws.iter().sum::<f32>() - 1.0).abs() < 1e-5);
        }
        let m = s.skin_matrices(&s.rest_pose()).unwrap();
        let (out, _) = skin(&pts, None, &w, &m).unwrap();
        for (a, b) in pts.iter().zip(&out) {
            assert!(length(sub(*a, *b)) < 1e-5);
        }
    }

    #[test]
    fn bending_the_forearm_moves_only_its_vertices() {
        let s = arm();
        let pts = vec![[0.0, 0.2, 0.0], [0.0, 1.9, 0.0]];
        let w = s.auto_weights(&pts, 6.0).unwrap();
        assert_eq!(w.joints[0][0], 0);
        assert_eq!(w.joints[1][0], 1);
        let mut pose = s.rest_pose();
        pose.locals[1].rotation = Quat::from_euler_xyz_deg([0.0, 0.0, 90.0]);
        let m = s.skin_matrices(&pose).unwrap();
        let (out, _) = skin(&pts, None, &w, &m).unwrap();
        assert!(length(sub(out[0], pts[0])) < 0.05, "{:?}", out[0]);
        // The tip (0, 1.9) rotates 90 degrees about Z around the elbow (0, 1).
        assert!(
            out[1][0] < -0.7 && (out[1][1] - 1.0).abs() < 0.15,
            "{:?}",
            out[1]
        );
    }

    #[test]
    fn validation_and_blend() {
        let mut s = arm();
        assert!(s.add_bone("root", None, Trs::IDENTITY, 1.0).is_err());
        assert!(s.add_bone("x", Some("nope"), Trs::IDENTITY, 1.0).is_err());
        s.bones[0].parent = Some(1);
        assert!(s.validate().is_err());
        let a = arm().rest_pose();
        let mut b = a.clone();
        b.locals[1].translation = [0.0, 3.0, 0.0];
        let h = a.blend(&b, 0.5).unwrap();
        assert!((h.locals[1].translation[1] - 2.0).abs() < 1e-6);
        assert!(a.blend(&Pose { locals: vec![] }, 0.5).is_err());
    }
}
