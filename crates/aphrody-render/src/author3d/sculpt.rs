// SPDX-License-Identifier: Apache-2.0
//! Sculpting brushes on [`PolyMesh`] vertices.
//!
//! A stroke is a polyline of surface points (object space). It is resampled
//! into dabs spaced at a fraction of the brush radius; each dab displaces the
//! vertices inside the radius with a falloff curve, an optional per-vertex
//! mask and optional X mirror symmetry. The brushes are the classic sculpting
//! set: draw, inflate, smooth, flatten, pinch and grab. Topology never
//! changes (dynamic topology/remeshing is not implemented); subdivide first
//! for detail.

use serde::{Deserialize, Serialize};

use super::{
    poly::{PolyError, PolyMesh},
    xform::{add, dot, length, normalize, scale, sub},
};

/// Brush kind.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrushKind {
    /// Push along the average normal of the area under the brush.
    #[default]
    Draw,
    /// Push each vertex along its own normal.
    Inflate,
    /// Relax towards the one-ring average (Laplacian smoothing).
    Smooth,
    /// Pull towards the average plane under the brush.
    Flatten,
    /// Pull towards the dab centre.
    Pinch,
    /// Translate the area by [`Brush::grab_delta`] over the whole stroke.
    Grab,
}

/// Falloff from the dab centre (`0`) to the radius (`1`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Falloff {
    /// Smoothstep bell, the usual default.
    #[default]
    Smooth,
    /// Linear ramp.
    Linear,
    /// Constant inside the radius.
    Constant,
    /// Sharp: `(1 - d)^3`.
    Sharp,
}

impl Falloff {
    fn weight(self, d: f32) -> f32 {
        if !(0.0..1.0).contains(&d) {
            return 0.0;
        }
        match self {
            Self::Smooth => {
                let t = 1.0 - d;
                t * t * (3.0 - 2.0 * t)
            }
            Self::Linear => 1.0 - d,
            Self::Constant => 1.0,
            Self::Sharp => (1.0 - d).powi(3),
        }
    }
}

/// Brush settings.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Brush {
    /// Kind.
    #[serde(default)]
    pub kind: BrushKind,
    /// Radius in object units.
    pub radius: f32,
    /// Strength per dab (distance for draw/inflate, factor for the others).
    #[serde(default = "default_strength")]
    pub strength: f32,
    /// Falloff curve.
    #[serde(default)]
    pub falloff: Falloff,
    /// Invert the displacement (carve instead of add).
    #[serde(default)]
    pub invert: bool,
    /// Mirror every dab across the X = 0 plane.
    #[serde(default)]
    pub symmetry_x: bool,
    /// Dab spacing as a fraction of the radius.
    #[serde(default = "default_spacing")]
    pub spacing: f32,
    /// Total translation of a grab stroke.
    #[serde(default)]
    pub grab_delta: [f32; 3],
}

const fn default_strength() -> f32 {
    0.05
}
const fn default_spacing() -> f32 {
    0.25
}

impl Default for Brush {
    fn default() -> Self {
        Self {
            kind: BrushKind::Draw,
            radius: 0.25,
            strength: default_strength(),
            falloff: Falloff::Smooth,
            invert: false,
            symmetry_x: false,
            spacing: default_spacing(),
            grab_delta: [0.0; 3],
        }
    }
}

/// Upper bound on dabs per stroke (keeps hostile strokes bounded).
pub const MAX_DABS: usize = 100_000;

/// What a stroke changed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct StrokeReport {
    /// Dabs applied (including mirrored ones).
    pub dabs: usize,
    /// Distinct vertices moved.
    pub vertices_moved: usize,
    /// Largest single-vertex displacement over the stroke.
    pub max_displacement: f32,
}

/// Apply a brush stroke. `mask` (one value per vertex, `1` = frozen) is
/// optional.
///
/// # Errors
/// [`PolyError`] for invalid brush values, an empty stroke, a mask of the
/// wrong length or too many dabs.
pub fn apply_stroke(
    mesh: &mut PolyMesh,
    brush: &Brush,
    stroke: &[[f32; 3]],
    mask: Option<&[f32]>,
) -> Result<StrokeReport, PolyError> {
    if !(brush.radius > 0.0 && brush.radius.is_finite()) {
        return Err(PolyError::Invalid("brush radius must be positive".into()));
    }
    if !brush.strength.is_finite() || !(brush.spacing > 0.0 && brush.spacing.is_finite()) {
        return Err(PolyError::Invalid("brush strength/spacing invalid".into()));
    }
    if stroke.is_empty() || stroke.iter().flatten().any(|c| !c.is_finite()) {
        return Err(PolyError::Invalid(
            "stroke must contain finite points".into(),
        ));
    }
    if let Some(m) = mask {
        if m.len() != mesh.positions.len() {
            return Err(PolyError::Invalid(
                "mask length differs from vertex count".into(),
            ));
        }
    }
    mesh.validate()?;
    let dabs = resample(stroke, brush.radius * brush.spacing)?;
    let start: Vec<[f32; 3]> = mesh.positions.clone();
    let neighbors = mesh.neighbors();
    let mut report = StrokeReport::default();
    let sign = if brush.invert { -1.0 } else { 1.0 };
    let grab_step = scale(brush.grab_delta, 1.0 / dabs.len() as f32);
    for &centre in &dabs {
        let mut centres = vec![centre];
        if brush.symmetry_x && centre[0].abs() > brush.radius * 1e-3 {
            centres.push([-centre[0], centre[1], centre[2]]);
        }
        for (ci, c) in centres.iter().enumerate() {
            let mirrored = ci == 1;
            report.dabs += 1;
            dab(
                mesh,
                &neighbors,
                brush,
                *c,
                sign,
                if mirrored {
                    [-grab_step[0], grab_step[1], grab_step[2]]
                } else {
                    grab_step
                },
                mask,
            );
        }
    }
    for (a, b) in start.iter().zip(&mesh.positions) {
        let d = length(sub(*a, *b));
        if d > 0.0 {
            report.vertices_moved += 1;
            report.max_displacement = report.max_displacement.max(d);
        }
    }
    Ok(report)
}

fn resample(stroke: &[[f32; 3]], step: f32) -> Result<Vec<[f32; 3]>, PolyError> {
    let mut out = vec![stroke[0]];
    let mut carry = 0.0_f32;
    for w in stroke.windows(2) {
        let seg = sub(w[1], w[0]);
        let len = length(seg);
        if len <= 0.0 {
            continue;
        }
        let dir = scale(seg, 1.0 / len);
        let mut t = step - carry;
        while t <= len {
            out.push(add(w[0], scale(dir, t)));
            if out.len() > MAX_DABS {
                return Err(PolyError::TooLarge("sculpt stroke dabs"));
            }
            t += step;
        }
        carry = len - (t - step);
    }
    Ok(out)
}

fn dab(
    mesh: &mut PolyMesh,
    neighbors: &[Vec<u32>],
    brush: &Brush,
    centre: [f32; 3],
    sign: f32,
    grab_step: [f32; 3],
    mask: Option<&[f32]>,
) {
    let r = brush.radius;
    let mut hits: Vec<(usize, f32)> = Vec::new();
    for (i, p) in mesh.positions.iter().enumerate() {
        let d = length(sub(*p, centre)) / r;
        let mut w = brush.falloff.weight(d);
        if let Some(m) = mask {
            w *= 1.0 - m[i].clamp(0.0, 1.0);
        }
        if w > 0.0 {
            hits.push((i, w));
        }
    }
    if hits.is_empty() {
        return;
    }
    let normals = match brush.kind {
        BrushKind::Draw | BrushKind::Inflate | BrushKind::Flatten | BrushKind::Pinch => {
            mesh.vertex_normals()
        }
        _ => Vec::new(),
    };
    let s = brush.strength * sign;
    match brush.kind {
        BrushKind::Draw => {
            let n = normalize(
                hits.iter()
                    .fold([0.0; 3], |acc, &(i, w)| add(acc, scale(normals[i], w))),
            );
            for &(i, w) in &hits {
                mesh.positions[i] = add(mesh.positions[i], scale(n, s * w * r));
            }
        }
        BrushKind::Inflate => {
            for &(i, w) in &hits {
                mesh.positions[i] = add(mesh.positions[i], scale(normals[i], s * w * r));
            }
        }
        BrushKind::Smooth => {
            let snapshot = mesh.positions.clone();
            let f = brush.strength.clamp(0.0, 1.0);
            for &(i, w) in &hits {
                let nb = &neighbors[i];
                if nb.is_empty() {
                    continue;
                }
                let avg = scale(
                    nb.iter()
                        .fold([0.0; 3], |acc, &j| add(acc, snapshot[j as usize])),
                    1.0 / nb.len() as f32,
                );
                mesh.positions[i] = add(snapshot[i], scale(sub(avg, snapshot[i]), f * w));
            }
        }
        BrushKind::Flatten => {
            let total: f32 = hits.iter().map(|&(_, w)| w).sum();
            let c = scale(
                hits.iter().fold([0.0; 3], |acc, &(i, w)| {
                    add(acc, scale(mesh.positions[i], w))
                }),
                1.0 / total,
            );
            let n = normalize(
                hits.iter()
                    .fold([0.0; 3], |acc, &(i, w)| add(acc, scale(normals[i], w))),
            );
            let f = brush.strength.clamp(0.0, 1.0);
            for &(i, w) in &hits {
                let p = mesh.positions[i];
                let h = dot(sub(p, c), n);
                mesh.positions[i] = sub(p, scale(n, h * f * w * sign));
            }
        }
        BrushKind::Pinch => {
            let f = brush.strength.clamp(0.0, 1.0) * sign;
            for &(i, w) in &hits {
                let p = mesh.positions[i];
                let to = sub(centre, p);
                // Tangential pull only: remove the normal component.
                let tangential = sub(to, scale(normals[i], dot(to, normals[i])));
                mesh.positions[i] = add(p, scale(tangential, f * w * 0.5));
            }
        }
        BrushKind::Grab => {
            for &(i, w) in &hits {
                mesh.positions[i] = add(mesh.positions[i], scale(grab_step, w));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sphere() -> PolyMesh {
        PolyMesh::quad_sphere(1.0, 4).unwrap()
    }

    #[test]
    fn draw_raises_surface_locally() {
        let mut m = sphere();
        let brush = Brush {
            radius: 0.4,
            strength: 0.2,
            ..Brush::default()
        };
        let r = apply_stroke(&mut m, &brush, &[[0.0, 1.0, 0.0]], None).unwrap();
        assert_eq!(r.dabs, 1);
        assert!(r.vertices_moved > 0);
        let top = m.positions.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
        assert!(top > 1.05, "{top}");
        // Far side untouched.
        let bottom = m.positions.iter().map(|p| p[1]).fold(f32::MAX, f32::min);
        assert!((bottom + 1.0).abs() < 1e-5);
        assert_eq!(m.topology().euler, 2);
    }

    #[test]
    fn invert_carves_and_mask_freezes() {
        let mut m = sphere();
        let brush = Brush {
            radius: 0.4,
            strength: 0.2,
            invert: true,
            ..Brush::default()
        };
        let mask: Vec<f32> = m.positions.iter().map(|_| 1.0).collect();
        let r = apply_stroke(&mut m, &brush, &[[0.0, 1.0, 0.0]], Some(&mask)).unwrap();
        assert_eq!(r.vertices_moved, 0);
        apply_stroke(&mut m, &brush, &[[0.0, 1.0, 0.0]], None).unwrap();
        let top = m.positions.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
        assert!(top < 0.99, "{top}");
    }

    #[test]
    fn symmetry_mirrors_dabs() {
        let mut m = sphere();
        let brush = Brush {
            radius: 0.3,
            strength: 0.3,
            symmetry_x: true,
            ..Brush::default()
        };
        apply_stroke(&mut m, &brush, &[[1.0, 0.0, 0.0]], None).unwrap();
        let max_x = m.positions.iter().map(|p| p[0]).fold(f32::MIN, f32::max);
        let min_x = m.positions.iter().map(|p| p[0]).fold(f32::MAX, f32::min);
        assert!((max_x + min_x).abs() < 1e-4, "{max_x} {min_x}");
        assert!(max_x > 1.05);
    }

    #[test]
    fn smooth_reduces_noise() {
        let mut m = PolyMesh::grid([2.0, 2.0], [16, 16]).unwrap();
        for (i, p) in m.positions.iter_mut().enumerate() {
            p[1] = if i % 2 == 0 { 0.05 } else { -0.05 };
        }
        let rough = |m: &PolyMesh| m.positions.iter().map(|p| p[1].abs()).sum::<f32>();
        let before = rough(&m);
        let brush = Brush {
            kind: BrushKind::Smooth,
            radius: 3.0,
            // A checkerboard is the Laplacian's worst case: 0.5 cancels it.
            strength: 0.5,
            falloff: Falloff::Constant,
            ..Brush::default()
        };
        apply_stroke(&mut m, &brush, &[[0.0, 0.0, 0.0]], None).unwrap();
        assert!(rough(&m) < before * 0.5);
    }

    #[test]
    fn flatten_and_grab_and_stroke_spacing() {
        let mut m = sphere();
        let flat = Brush {
            kind: BrushKind::Flatten,
            radius: 0.5,
            strength: 1.0,
            falloff: Falloff::Constant,
            ..Brush::default()
        };
        apply_stroke(&mut m, &flat, &[[0.0, 1.0, 0.0]], None).unwrap();
        let top = m.positions.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
        assert!(top < 0.999, "{top}");

        let mut g = sphere();
        let grab = Brush {
            kind: BrushKind::Grab,
            radius: 0.3,
            falloff: Falloff::Constant,
            grab_delta: [0.0, 0.0, 0.5],
            ..Brush::default()
        };
        let r = apply_stroke(&mut g, &grab, &[[0.0, 0.0, 1.0]], None).unwrap();
        assert!((r.max_displacement - 0.5).abs() < 1e-4, "{r:?}");

        let mut s = sphere();
        let line = Brush {
            radius: 0.2,
            spacing: 0.25,
            ..Brush::default()
        };
        let r = apply_stroke(&mut s, &line, &[[-0.5, 0.9, 0.0], [0.5, 0.9, 0.0]], None).unwrap();
        assert!((20..=21).contains(&r.dabs), "{r:?}");
    }

    #[test]
    fn rejects_bad_input() {
        let mut m = sphere();
        let b = Brush::default();
        assert!(apply_stroke(&mut m, &b, &[], None).is_err());
        assert!(apply_stroke(&mut m, &b, &[[f32::NAN, 0.0, 0.0]], None).is_err());
        assert!(apply_stroke(&mut m, &b, &[[0.0; 3]], Some(&[0.0])).is_err());
        let zero = Brush { radius: 0.0, ..b };
        assert!(apply_stroke(&mut m, &zero, &[[0.0; 3]], None).is_err());
    }
}
