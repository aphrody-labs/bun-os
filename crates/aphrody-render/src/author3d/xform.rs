// SPDX-License-Identifier: Apache-2.0
//! Quaternions and translation/rotation/scale transforms for rigging and
//! animation. Conventions follow [`crate::math3d`]: right-handed, column-major
//! matrices, XYZ Euler order (`R = Rx * Ry * Rz`).

use serde::{Deserialize, Serialize};

use crate::math3d::{Mat4, Vec3};

/// A unit rotation quaternion `(x, y, z, w)`; serialized as `[x, y, z, w]`
/// (the glTF layout).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "[f32; 4]", into = "[f32; 4]")]
pub struct Quat {
    /// X.
    pub x: f32,
    /// Y.
    pub y: f32,
    /// Z.
    pub z: f32,
    /// W (scalar part).
    pub w: f32,
}

impl From<[f32; 4]> for Quat {
    fn from(v: [f32; 4]) -> Self {
        Self {
            x: v[0],
            y: v[1],
            z: v[2],
            w: v[3],
        }
    }
}

impl From<Quat> for [f32; 4] {
    fn from(q: Quat) -> Self {
        [q.x, q.y, q.z, q.w]
    }
}

impl Default for Quat {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Quat {
    /// No rotation.
    pub const IDENTITY: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    };

    /// Rotation of `radians` around `axis` (normalized here).
    #[must_use]
    pub fn from_axis_angle(axis: [f32; 3], radians: f32) -> Self {
        let a = Vec3::from_array(axis).normalize_or(Vec3::Y);
        let (s, c) = (radians * 0.5).sin_cos();
        Self {
            x: a.x * s,
            y: a.y * s,
            z: a.z * s,
            w: c,
        }
    }

    /// Rotation from XYZ Euler angles in degrees, identical to
    /// [`Mat4::rotation_xyz`] (`q = qx * qy * qz`).
    #[must_use]
    pub fn from_euler_xyz_deg(deg: [f32; 3]) -> Self {
        let qx = Self::from_axis_angle([1.0, 0.0, 0.0], deg[0].to_radians());
        let qy = Self::from_axis_angle([0.0, 1.0, 0.0], deg[1].to_radians());
        let qz = Self::from_axis_angle([0.0, 0.0, 1.0], deg[2].to_radians());
        qx.mul(qy).mul(qz)
    }

    /// Hamilton product `self * o` (apply `o` first).
    #[must_use]
    pub fn mul(self, o: Self) -> Self {
        Self {
            x: self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            y: self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            z: self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
            w: self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
        }
    }

    /// Four-component dot product.
    #[must_use]
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z + self.w * o.w
    }

    /// Unit-length copy (identity when degenerate or non-finite).
    #[must_use]
    pub fn normalize(self) -> Self {
        let len = self.dot(self).sqrt();
        if !len.is_finite() || len < 1e-12 {
            return Self::IDENTITY;
        }
        Self {
            x: self.x / len,
            y: self.y / len,
            z: self.z / len,
            w: self.w / len,
        }
    }

    /// Rotate a vector.
    #[must_use]
    pub fn rotate(self, v: [f32; 3]) -> [f32; 3] {
        self.to_mat4()
            .transform_vector(Vec3::from_array(v))
            .to_array()
    }

    /// Shortest-path spherical interpolation.
    #[must_use]
    pub fn slerp(self, o: Self, t: f32) -> Self {
        let mut b = o;
        let mut d = self.dot(o);
        if d < 0.0 {
            b = Self {
                x: -o.x,
                y: -o.y,
                z: -o.z,
                w: -o.w,
            };
            d = -d;
        }
        if d > 0.9995 {
            return Self {
                x: self.x + (b.x - self.x) * t,
                y: self.y + (b.y - self.y) * t,
                z: self.z + (b.z - self.z) * t,
                w: self.w + (b.w - self.w) * t,
            }
            .normalize();
        }
        let theta = d.clamp(-1.0, 1.0).acos();
        let s = theta.sin();
        let wa = ((1.0 - t) * theta).sin() / s;
        let wb = (t * theta).sin() / s;
        Self {
            x: self.x * wa + b.x * wb,
            y: self.y * wa + b.y * wb,
            z: self.z * wa + b.z * wb,
            w: self.w * wa + b.w * wb,
        }
        .normalize()
    }

    /// The rotation matrix.
    #[must_use]
    pub fn to_mat4(self) -> Mat4 {
        let Self { x, y, z, w } = self.normalize();
        Mat4 {
            cols: [
                [
                    1.0 - 2.0 * (y * y + z * z),
                    2.0 * (x * y + w * z),
                    2.0 * (x * z - w * y),
                    0.0,
                ],
                [
                    2.0 * (x * y - w * z),
                    1.0 - 2.0 * (x * x + z * z),
                    2.0 * (y * z + w * x),
                    0.0,
                ],
                [
                    2.0 * (x * z + w * y),
                    2.0 * (y * z - w * x),
                    1.0 - 2.0 * (x * x + y * y),
                    0.0,
                ],
                [0.0, 0.0, 0.0, 1.0],
            ],
        }
    }

    /// Whether every component is finite.
    #[must_use]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite() && self.w.is_finite()
    }
}

/// Translation, quaternion rotation and scale (`T * R * S`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Trs {
    /// Translation.
    #[serde(default)]
    pub translation: [f32; 3],
    /// Rotation.
    #[serde(default)]
    pub rotation: Quat,
    /// Scale.
    #[serde(default = "unit3")]
    pub scale: [f32; 3],
}

const fn unit3() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}

impl Default for Trs {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Trs {
    /// The identity transform.
    pub const IDENTITY: Self = Self {
        translation: [0.0; 3],
        rotation: Quat::IDENTITY,
        scale: [1.0; 3],
    };

    /// The local matrix `T * R * S`.
    #[must_use]
    pub fn matrix(&self) -> Mat4 {
        let mut m = self.rotation.to_mat4();
        for (c, s) in self.scale.iter().enumerate() {
            for r in 0..3 {
                m.cols[c][r] *= s;
            }
        }
        m.cols[3] = [
            self.translation[0],
            self.translation[1],
            self.translation[2],
            1.0,
        ];
        m
    }

    /// Component-wise blend: lerp translation and scale, slerp rotation.
    #[must_use]
    pub fn blend(&self, o: &Self, t: f32) -> Self {
        Self {
            translation: lerp3(self.translation, o.translation, t),
            rotation: self.rotation.slerp(o.rotation, t),
            scale: lerp3(self.scale, o.scale, t),
        }
    }

    /// Whether every component is finite.
    #[must_use]
    pub fn is_finite(&self) -> bool {
        self.translation.iter().all(|v| v.is_finite())
            && self.scale.iter().all(|v| v.is_finite())
            && self.rotation.is_finite()
    }
}

/// Linear interpolation of two 3-vectors.
#[must_use]
pub fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

/// Inverse of an affine matrix (last row `0 0 0 1`); `None` when singular.
#[must_use]
pub fn affine_inverse(m: &Mat4) -> Option<Mat4> {
    let c = &m.cols;
    let (a, b, cc) = (
        [c[0][0], c[0][1], c[0][2]],
        [c[1][0], c[1][1], c[1][2]],
        [c[2][0], c[2][1], c[2][2]],
    );
    // Rows of the inverse 3x3 are the cross products of the columns / det.
    let r0 = cross(b, cc);
    let r1 = cross(cc, a);
    let r2 = cross(a, b);
    let det = dot(a, r0);
    if !det.is_finite() || det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let (r0, r1, r2) = (scale(r0, inv), scale(r1, inv), scale(r2, inv));
    let t = [c[3][0], c[3][1], c[3][2]];
    let it = [-dot(r0, t), -dot(r1, t), -dot(r2, t)];
    Some(Mat4 {
        cols: [
            [r0[0], r1[0], r2[0], 0.0],
            [r0[1], r1[1], r2[1], 0.0],
            [r0[2], r1[2], r2[2], 0.0],
            [it[0], it[1], it[2], 1.0],
        ],
    })
}

pub(crate) fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(crate) fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn scale(a: [f32; 3], s: f32) -> [f32; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

pub(crate) fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub(crate) fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(crate) fn length(a: [f32; 3]) -> f32 {
    dot(a, a).sqrt()
}

pub(crate) fn normalize(a: [f32; 3]) -> [f32; 3] {
    let l = length(a);
    if l > 1e-20 && l.is_finite() {
        scale(a, 1.0 / l)
    } else {
        [0.0, 0.0, 0.0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &Mat4, b: &Mat4) -> bool {
        a.cols
            .iter()
            .flatten()
            .zip(b.cols.iter().flatten())
            .all(|(x, y)| (x - y).abs() < 1e-5)
    }

    #[test]
    fn euler_quat_matches_matrix_convention() {
        for deg in [[30.0, 0.0, 0.0], [0.0, 45.0, 0.0], [10.0, -70.0, 120.0]] {
            let q = Quat::from_euler_xyz_deg(deg);
            let m = Mat4::rotation_xyz(
                f32::to_radians(deg[0]),
                f32::to_radians(deg[1]),
                f32::to_radians(deg[2]),
            );
            assert!(close(&q.to_mat4(), &m), "{deg:?}");
        }
    }

    #[test]
    fn trs_inverse_roundtrip() {
        let t = Trs {
            translation: [1.0, -2.0, 3.5],
            rotation: Quat::from_euler_xyz_deg([20.0, 40.0, -10.0]),
            scale: [2.0, 0.5, 1.5],
        };
        let m = t.matrix();
        let inv = affine_inverse(&m).expect("invertible");
        assert!(close(&m.mul(&inv), &Mat4::IDENTITY));
    }

    #[test]
    fn slerp_halfway() {
        let a = Quat::IDENTITY;
        let b = Quat::from_axis_angle([0.0, 1.0, 0.0], std::f32::consts::FRAC_PI_2);
        let h = a.slerp(b, 0.5);
        let e = Quat::from_axis_angle([0.0, 1.0, 0.0], std::f32::consts::FRAC_PI_4);
        assert!((h.dot(e).abs() - 1.0).abs() < 1e-5);
    }
}
