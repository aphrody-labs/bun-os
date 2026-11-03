// SPDX-License-Identifier: Apache-2.0
//! Keyframe animation clips: per-bone translation/rotation/scale channels
//! with step, linear or smooth (Catmull-Rom) interpolation, sampled into a
//! [`Pose`] and blended between clips.
//!
//! Channels mirror glTF animation samplers (times plus values, rotation as
//! quaternions) so clips map one to one onto glTF animations.

use serde::{Deserialize, Serialize};

use super::{
    rig::{Pose, RigError, Skeleton},
    xform::{Quat, lerp3},
};

/// Upper bound on keys per channel.
pub const MAX_KEYS: usize = 100_000;

/// Animated property.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Property {
    /// Local translation (`[x, y, z]`).
    Translation,
    /// Local rotation (quaternion `[x, y, z, w]`).
    Rotation,
    /// Local scale (`[x, y, z]`).
    Scale,
}

/// Interpolation between keys.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Interpolation {
    /// Hold the previous key.
    Step,
    /// Lerp (slerp for rotations).
    #[default]
    Linear,
    /// Catmull-Rom for vectors; eased slerp for rotations.
    Smooth,
}

/// One animated property of one bone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Channel {
    /// Bone name.
    pub bone: String,
    /// Property.
    pub property: Property,
    /// Interpolation.
    #[serde(default)]
    pub interpolation: Interpolation,
    /// Strictly increasing key times, seconds.
    pub times: Vec<f32>,
    /// One value per key (`w` ignored for translation and scale).
    pub values: Vec<[f32; 4]>,
}

/// A named set of channels.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    /// Name.
    pub name: String,
    /// Channels.
    pub channels: Vec<Channel>,
    /// Wrap time around the duration instead of clamping.
    #[serde(default)]
    pub looping: bool,
}

impl Channel {
    fn validate(&self) -> Result<(), RigError> {
        let bad = |why: &str| Err(RigError::Invalid(format!("channel {}: {why}", self.bone)));
        if self.times.is_empty() || self.times.len() != self.values.len() {
            return bad("needs as many values as times (at least one)");
        }
        if self.times.len() > MAX_KEYS {
            return bad("too many keys");
        }
        if self.times.iter().any(|t| !t.is_finite() || *t < 0.0)
            || self.values.iter().flatten().any(|v| !v.is_finite())
        {
            return bad("non-finite or negative key");
        }
        if self.times.windows(2).any(|w| w[1] <= w[0]) {
            return bad("key times must strictly increase");
        }
        Ok(())
    }

    /// Value at time `t` (clamped to the key range).
    #[must_use]
    pub fn sample(&self, t: f32) -> [f32; 4] {
        let n = self.times.len();
        if n == 1 || t <= self.times[0] {
            return self.values[0];
        }
        if t >= self.times[n - 1] {
            return self.values[n - 1];
        }
        let i = self.times.partition_point(|&k| k <= t) - 1;
        let (t0, t1) = (self.times[i], self.times[i + 1]);
        let u = (t - t0) / (t1 - t0);
        let (a, b) = (self.values[i], self.values[i + 1]);
        match (self.interpolation, self.property) {
            (Interpolation::Step, _) => a,
            (Interpolation::Linear, Property::Rotation) => Quat::from(a)
                .normalize()
                .slerp(Quat::from(b).normalize(), u)
                .into(),
            (Interpolation::Smooth, Property::Rotation) => {
                let e = u * u * (3.0 - 2.0 * u);
                Quat::from(a)
                    .normalize()
                    .slerp(Quat::from(b).normalize(), e)
                    .into()
            }
            (Interpolation::Linear, _) => {
                let v = lerp3([a[0], a[1], a[2]], [b[0], b[1], b[2]], u);
                [v[0], v[1], v[2], 0.0]
            }
            (Interpolation::Smooth, _) => {
                let p0 = if i == 0 { a } else { self.values[i - 1] };
                let p3 = if i + 2 < n { self.values[i + 2] } else { b };
                let mut out = [0.0; 4];
                for c in 0..3 {
                    out[c] = catmull_rom(p0[c], a[c], b[c], p3[c], u);
                }
                out
            }
        }
    }
}

fn catmull_rom(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    let t2 = t * t;
    let t3 = t2 * t;
    0.5 * (2.0 * p1
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)
}

impl Clip {
    /// Validate every channel against `skeleton`.
    ///
    /// # Errors
    /// [`RigError`] for malformed keys or unknown bones.
    pub fn validate(&self, skeleton: &Skeleton) -> Result<(), RigError> {
        for c in &self.channels {
            c.validate()?;
            if skeleton.find(&c.bone).is_none() {
                return Err(RigError::Invalid(format!(
                    "clip {}: unknown bone {:?}",
                    self.name, c.bone
                )));
            }
        }
        Ok(())
    }

    /// Duration: the last key time over all channels.
    #[must_use]
    pub fn duration(&self) -> f32 {
        self.channels
            .iter()
            .filter_map(|c| c.times.last().copied())
            .fold(0.0, f32::max)
    }

    /// Sample the clip on top of the rest pose.
    ///
    /// # Errors
    /// [`RigError`] for an invalid clip.
    pub fn sample(&self, skeleton: &Skeleton, time: f32) -> Result<Pose, RigError> {
        self.validate(skeleton)?;
        let d = self.duration();
        let t = if self.looping && d > 0.0 {
            time.rem_euclid(d)
        } else {
            time.clamp(0.0, d)
        };
        let mut pose = skeleton.rest_pose();
        for c in &self.channels {
            let Some(b) = skeleton.find(&c.bone) else {
                continue;
            };
            let v = c.sample(t);
            let local = &mut pose.locals[b];
            match c.property {
                Property::Translation => local.translation = [v[0], v[1], v[2]],
                Property::Rotation => local.rotation = Quat::from(v).normalize(),
                Property::Scale => local.scale = [v[0], v[1], v[2]],
            }
        }
        Ok(pose)
    }
}

/// Sample two clips and cross-fade them (`weight` 0 = `a`, 1 = `b`).
///
/// # Errors
/// [`RigError`] for invalid clips.
pub fn sample_blend(
    skeleton: &Skeleton,
    a: &Clip,
    time_a: f32,
    b: &Clip,
    time_b: f32,
    weight: f32,
) -> Result<Pose, RigError> {
    a.sample(skeleton, time_a)?
        .blend(&b.sample(skeleton, time_b)?, weight)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::author3d::xform::Trs;

    fn skel() -> Skeleton {
        let mut s = Skeleton::default();
        s.add_bone("root", None, Trs::IDENTITY, 1.0).unwrap();
        s
    }

    fn chan(property: Property, interpolation: Interpolation, keys: &[(f32, [f32; 4])]) -> Channel {
        Channel {
            bone: "root".into(),
            property,
            interpolation,
            times: keys.iter().map(|k| k.0).collect(),
            values: keys.iter().map(|k| k.1).collect(),
        }
    }

    #[test]
    fn linear_step_smooth_translation() {
        let keys = [
            (0.0, [0.0; 4]),
            (1.0, [2.0, 0.0, 0.0, 0.0]),
            (2.0, [2.0, 2.0, 0.0, 0.0]),
        ];
        let lin = chan(Property::Translation, Interpolation::Linear, &keys);
        assert_eq!(lin.sample(0.5)[0], 1.0);
        assert_eq!(lin.sample(-1.0), [0.0; 4]);
        assert_eq!(lin.sample(9.0)[1], 2.0);
        let step = chan(Property::Translation, Interpolation::Step, &keys);
        assert_eq!(step.sample(0.99)[0], 0.0);
        let smooth = chan(Property::Translation, Interpolation::Smooth, &keys);
        assert!((smooth.sample(1.0)[0] - 2.0).abs() < 1e-6);
        let mid = smooth.sample(0.5)[0];
        assert!(mid > 0.5 && mid < 1.6, "{mid}");
    }

    #[test]
    fn rotation_clip_samples_and_loops() {
        let s = skel();
        let q90: [f32; 4] = Quat::from_euler_xyz_deg([0.0, 90.0, 0.0]).into();
        let clip = Clip {
            name: "turn".into(),
            looping: true,
            channels: vec![chan(
                Property::Rotation,
                Interpolation::Linear,
                &[(0.0, Quat::IDENTITY.into()), (1.0, q90)],
            )],
        };
        assert!((clip.duration() - 1.0).abs() < 1e-6);
        let half = clip.sample(&s, 0.5).unwrap().locals[0].rotation;
        let e = Quat::from_euler_xyz_deg([0.0, 45.0, 0.0]);
        assert!((half.dot(e).abs() - 1.0).abs() < 1e-5);
        let wrapped = clip.sample(&s, 1.5).unwrap().locals[0].rotation;
        assert!((wrapped.dot(e).abs() - 1.0).abs() < 1e-5);
    }

    #[test]
    fn blend_between_clips_and_validation() {
        let s = skel();
        let at = |x: f32| Clip {
            name: format!("x{x}"),
            looping: false,
            channels: vec![chan(
                Property::Translation,
                Interpolation::Linear,
                &[(0.0, [x, 0.0, 0.0, 0.0])],
            )],
        };
        let p = sample_blend(&s, &at(0.0), 0.0, &at(4.0), 0.0, 0.25).unwrap();
        assert!((p.locals[0].translation[0] - 1.0).abs() < 1e-6);
        let mut bad = at(1.0);
        bad.channels[0].bone = "nope".into();
        assert!(bad.sample(&s, 0.0).is_err());
        let mut unordered = at(1.0);
        unordered.channels[0].times = vec![1.0, 0.5];
        unordered.channels[0].values = vec![[0.0; 4]; 2];
        assert!(unordered.validate(&s).is_err());
    }
}
