// SPDX-License-Identifier: Apache-2.0
//! The 3D authoring document, its JSON command set and the bridge to the
//! renderer.
//!
//! A [`Document3d`] holds editable objects ([`PolyMesh`] + transform +
//! material + optional skin), a material library, one skeleton and animation
//! clips. Every edit is an [`Op`] (serde-tagged JSON, so CLIs, agents, MCP
//! tools and UIs drive the same surface); [`Editor`] applies ops atomically
//! with undo/redo. [`Document3d::scene`] evaluates the document at a time
//! (skinning + clip sampling) into the renderer's [`Scene3d`], which renders
//! on the CPU reference or `wgpu` backend and exports to GLB.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{
    anim::{Channel, Clip, Interpolation, Property},
    material::{MaterialDef, parse_paint, preset},
    poly::{PolyError, PolyMesh, Shading, Topology},
    rig::{RigError, Skeleton, SkinWeights, skin},
    sculpt::{Brush, StrokeReport, apply_stroke},
    xform::{Quat, Trs, affine_inverse},
};
use crate::{
    math3d::Vec3,
    mesh3d::Geometry,
    model::{StudioOptions, studio_scene, write_glb},
    scene3d::{Node3d, Scene3d, Transform},
};

/// Upper bound on objects per document.
pub const MAX_OBJECTS: usize = 4096;
/// Upper bound on subdivision levels per operation.
pub const MAX_SUBDIVISION_LEVELS: u32 = 4;
/// Depth of the undo history.
pub const UNDO_LIMIT: usize = 64;

/// Why a document operation failed. A failed op leaves the document
/// unchanged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Doc3dError {
    /// No object with that name.
    UnknownObject(String),
    /// An object with that name already exists.
    DuplicateObject(String),
    /// A modeling or sculpting operation failed.
    Mesh(PolyError),
    /// A rig or animation operation failed.
    Rig(RigError),
    /// A material is invalid or unknown.
    Material(String),
    /// Other invalid input.
    Invalid(String),
    /// Scene building, rendering or export failed.
    Render(String),
}

impl std::fmt::Display for Doc3dError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownObject(n) => write!(f, "unknown object {n:?}"),
            Self::DuplicateObject(n) => write!(f, "object {n:?} already exists"),
            Self::Mesh(e) => e.fmt(f),
            Self::Rig(e) => e.fmt(f),
            Self::Material(e) => write!(f, "material: {e}"),
            Self::Invalid(e) => write!(f, "invalid operation: {e}"),
            Self::Render(e) => write!(f, "render: {e}"),
        }
    }
}

impl std::error::Error for Doc3dError {}

impl From<PolyError> for Doc3dError {
    fn from(e: PolyError) -> Self {
        Self::Mesh(e)
    }
}

impl From<RigError> for Doc3dError {
    fn from(e: RigError) -> Self {
        Self::Rig(e)
    }
}

/// One editable object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Object3d {
    /// Unique name.
    pub name: String,
    /// Editable mesh in object space.
    pub mesh: PolyMesh,
    /// Object transform.
    #[serde(default)]
    pub transform: Trs,
    /// Material library key (`None` = default clay).
    #[serde(default)]
    pub material: Option<String>,
    /// Shading mode.
    #[serde(default)]
    pub shading: Shading,
    /// Skin binding to the document skeleton (weights per mesh vertex).
    #[serde(default)]
    pub skin: Option<SkinWeights>,
    /// Hidden objects are skipped when building scenes.
    #[serde(default = "yes")]
    pub visible: bool,
}

const fn yes() -> bool {
    true
}

/// The authoring document.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Document3d {
    /// Objects.
    #[serde(default)]
    pub objects: Vec<Object3d>,
    /// Material library (presets are available without definition).
    #[serde(default)]
    pub materials: BTreeMap<String, MaterialDef>,
    /// Skeleton shared by skinned objects (skeleton space = world space).
    #[serde(default)]
    pub skeleton: Skeleton,
    /// Animation clips.
    #[serde(default)]
    pub clips: Vec<Clip>,
}

/// Starting shape of a new object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "shape", rename_all = "snake_case")]
pub enum Primitive {
    /// Box of six quads.
    Cube {
        /// Extents.
        #[serde(default = "unit3")]
        size: [f32; 3],
    },
    /// Quad grid in XZ facing +Y.
    Grid {
        /// Extents.
        #[serde(default = "unit2")]
        size: [f32; 2],
        /// Quads along X and Z.
        #[serde(default = "grid_div")]
        divisions: [u32; 2],
    },
    /// All-quad sphere (subdivided cube).
    QuadSphere {
        /// Radius.
        #[serde(default = "half")]
        radius: f32,
        /// Subdivision level (0..=7).
        #[serde(default = "sphere_level")]
        level: u32,
    },
    /// Any renderer geometry, welded into connected topology.
    Geometry {
        /// Geometry.
        geometry: Geometry,
    },
}

const fn unit3() -> [f32; 3] {
    [1.0; 3]
}
const fn unit2() -> [f32; 2] {
    [1.0; 2]
}
const fn grid_div() -> [u32; 2] {
    [8, 8]
}
const fn half() -> f32 {
    0.5
}
const fn sphere_level() -> u32 {
    4
}

/// Euler-angle transform as written in commands.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct TransformSpec {
    /// Translation.
    #[serde(default)]
    pub translation: [f32; 3],
    /// XYZ Euler rotation, degrees.
    #[serde(default)]
    pub rotation_euler_deg: [f32; 3],
    /// Scale.
    #[serde(default = "unit3")]
    pub scale: [f32; 3],
}

impl Default for TransformSpec {
    fn default() -> Self {
        Self {
            translation: [0.0; 3],
            rotation_euler_deg: [0.0; 3],
            scale: [1.0; 3],
        }
    }
}

impl TransformSpec {
    /// Convert to a quaternion transform.
    #[must_use]
    pub fn to_trs(&self) -> Trs {
        Trs {
            translation: self.translation,
            rotation: Quat::from_euler_xyz_deg(self.rotation_euler_deg),
            scale: self.scale,
        }
    }
}

/// Which faces an operator acts on.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "select", rename_all = "snake_case")]
pub enum FaceSelection {
    /// Every face.
    All,
    /// Explicit face indices.
    Indices {
        /// Face indices.
        faces: Vec<usize>,
    },
    /// Faces whose normal is within `max_angle_deg` of `direction`
    /// (object space).
    Facing {
        /// Direction.
        direction: [f32; 3],
        /// Cone half-angle, degrees.
        #[serde(default = "default_cone")]
        max_angle_deg: f32,
    },
}

const fn default_cone() -> f32 {
    1.0
}

impl FaceSelection {
    fn resolve(&self, mesh: &PolyMesh) -> Vec<usize> {
        match self {
            Self::All => (0..mesh.faces.len()).collect(),
            Self::Indices { faces } => faces.clone(),
            Self::Facing {
                direction,
                max_angle_deg,
            } => mesh.faces_facing(*direction, *max_angle_deg),
        }
    }
}

/// A ray in object space used to place sculpt dabs on the surface.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Ray {
    /// Origin.
    pub origin: [f32; 3],
    /// Direction.
    pub direction: [f32; 3],
}

/// One key of a [`TrackSpec`].
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct KeySpec {
    /// Time, seconds.
    pub time: f32,
    /// Translation/scale `[x, y, z]`, or XYZ Euler degrees for rotation.
    pub value: [f32; 3],
}

/// One animated property of one bone, as written in commands.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TrackSpec {
    /// Bone name.
    pub bone: String,
    /// Property.
    pub property: Property,
    /// Interpolation.
    #[serde(default)]
    pub interpolation: Interpolation,
    /// Keys in increasing time order.
    pub keys: Vec<KeySpec>,
}

/// A clip as written in commands.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClipSpec {
    /// Name.
    pub name: String,
    /// Loop playback.
    #[serde(default)]
    pub looping: bool,
    /// Tracks.
    pub tracks: Vec<TrackSpec>,
}

impl ClipSpec {
    fn to_clip(&self) -> Clip {
        Clip {
            name: self.name.clone(),
            looping: self.looping,
            channels: self
                .tracks
                .iter()
                .map(|t| Channel {
                    bone: t.bone.clone(),
                    property: t.property,
                    interpolation: t.interpolation,
                    times: t.keys.iter().map(|k| k.time).collect(),
                    values: t
                        .keys
                        .iter()
                        .map(|k| match t.property {
                            Property::Rotation => Quat::from_euler_xyz_deg(k.value).into(),
                            _ => [k.value[0], k.value[1], k.value[2], 0.0],
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

/// A document edit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    /// Create an object.
    AddObject {
        /// Unique name.
        name: String,
        /// Starting shape.
        primitive: Primitive,
        /// Transform.
        #[serde(default)]
        transform: TransformSpec,
        /// Material key or preset.
        #[serde(default)]
        material: Option<String>,
        /// Shading.
        #[serde(default)]
        shading: Shading,
    },
    /// Delete an object.
    RemoveObject {
        /// Object.
        object: String,
    },
    /// Replace an object's transform.
    SetTransform {
        /// Object.
        object: String,
        /// Transform.
        transform: TransformSpec,
    },
    /// Region extrusion along averaged normals.
    Extrude {
        /// Object.
        object: String,
        /// Faces.
        faces: FaceSelection,
        /// Distance (negative pushes inwards).
        distance: f32,
    },
    /// Per-face inset.
    Inset {
        /// Object.
        object: String,
        /// Faces.
        faces: FaceSelection,
        /// Fraction towards the centroid, `(0, 1)`.
        amount: f32,
    },
    /// Catmull-Clark subdivision.
    Subdivide {
        /// Object.
        object: String,
        /// Levels (1..=4).
        #[serde(default = "one_level")]
        levels: u32,
    },
    /// Weld close vertices.
    MergeByDistance {
        /// Object.
        object: String,
        /// Distance.
        distance: f32,
    },
    /// One sculpt stroke (object space).
    Sculpt {
        /// Object.
        object: String,
        /// Brush.
        brush: Brush,
        /// Stroke points on the surface.
        #[serde(default)]
        stroke: Vec<[f32; 3]>,
        /// Rays picked against the surface; hits are appended to `stroke`.
        #[serde(default)]
        rays: Vec<Ray>,
    },
    /// Add or replace a library material.
    DefineMaterial {
        /// Key.
        name: String,
        /// Definition.
        material: MaterialDef,
    },
    /// Assign a library material or preset.
    AssignMaterial {
        /// Object.
        object: String,
        /// Key or preset name.
        material: String,
    },
    /// Change shading.
    SetShading {
        /// Object.
        object: String,
        /// Shading.
        shading: Shading,
    },
    /// Append a bone to the skeleton.
    AddBone {
        /// Unique name.
        name: String,
        /// Parent bone.
        #[serde(default)]
        parent: Option<String>,
        /// Local rest transform relative to the parent.
        #[serde(default)]
        transform: TransformSpec,
        /// Display/leaf length.
        #[serde(default = "bone_length")]
        length: f32,
    },
    /// Compute automatic weights and bind the object to the skeleton.
    BindSkin {
        /// Object.
        object: String,
        /// Falloff sharpness.
        #[serde(default = "weight_power")]
        power: f32,
    },
    /// Add or replace an animation clip.
    AddClip {
        /// Clip.
        clip: ClipSpec,
    },
}

const fn one_level() -> u32 {
    1
}
const fn bone_length() -> f32 {
    0.25
}
const fn weight_power() -> f32 {
    4.0
}

/// What an operation did.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct OpReport {
    /// Object touched, when any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object: Option<String>,
    /// Topology after the op.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology: Option<Topology>,
    /// Faces created or selected by the op.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub faces: Vec<usize>,
    /// Sculpt result.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke: Option<StrokeReport>,
    /// A topology change invalidated the object's skin binding.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub skin_cleared: bool,
}

/// How to evaluate and frame the document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ViewSpec {
    /// Width, pixels.
    pub width: u32,
    /// Height, pixels.
    pub height: u32,
    /// Clip to play (`None` = rest pose).
    pub clip: Option<String>,
    /// Time, seconds.
    pub time: f32,
    /// Camera azimuth, degrees.
    pub yaw_deg: f32,
    /// Camera elevation, degrees.
    pub pitch_deg: f32,
    /// Zoom (1 = framed).
    pub zoom: f32,
    /// M3 seed colour `0xAARRGGBB`.
    pub seed_argb: u32,
    /// Dark scheme.
    pub is_dark: bool,
    /// Background paint (hex or M3 role; `None` = transparent).
    pub background: Option<String>,
    /// Shadow mapping.
    pub shadows: bool,
}

impl Default for ViewSpec {
    fn default() -> Self {
        let s = StudioOptions::default();
        Self {
            width: 640,
            height: 480,
            clip: None,
            time: 0.0,
            yaw_deg: s.yaw_deg,
            pitch_deg: s.pitch_deg,
            zoom: s.zoom,
            seed_argb: s.seed_argb,
            is_dark: false,
            background: Some("surface_container".into()),
            shadows: true,
        }
    }
}

/// Per-object summary.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ObjectStats {
    /// Name.
    pub name: String,
    /// Topology.
    pub topology: Topology,
    /// Signed volume.
    pub volume: f32,
    /// Bound to the skeleton.
    pub skinned: bool,
    /// Material key.
    pub material: Option<String>,
}

/// Document summary.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DocumentStats {
    /// Objects.
    pub objects: Vec<ObjectStats>,
    /// Bone names.
    pub bones: Vec<String>,
    /// Clip names and durations.
    pub clips: Vec<(String, f32)>,
}

impl Document3d {
    fn index(&self, name: &str) -> Result<usize, Doc3dError> {
        self.objects
            .iter()
            .position(|o| o.name == name)
            .ok_or_else(|| Doc3dError::UnknownObject(name.to_string()))
    }

    /// Object by name.
    #[must_use]
    pub fn object(&self, name: &str) -> Option<&Object3d> {
        self.objects.iter().find(|o| o.name == name)
    }

    /// Resolve a material key: library first, then presets.
    ///
    /// # Errors
    /// [`Doc3dError::Material`] for unknown keys or invalid definitions.
    pub fn material_def(&self, key: &str) -> Result<MaterialDef, Doc3dError> {
        self.materials
            .get(key)
            .cloned()
            .or_else(|| preset(key))
            .ok_or_else(|| Doc3dError::Material(format!("unknown material {key:?}")))
    }

    fn check_material(&self, key: &str) -> Result<(), Doc3dError> {
        self.material_def(key)?
            .to_material()
            .map(|_| ())
            .map_err(Doc3dError::Material)
    }

    /// Apply one operation in place. Prefer [`Editor::apply`], which is
    /// atomic and undoable; this mutates directly and may leave partial
    /// changes on error.
    ///
    /// # Errors
    /// [`Doc3dError`] describing why the op was refused.
    pub fn apply(&mut self, op: &Op) -> Result<OpReport, Doc3dError> {
        let mut report = OpReport::default();
        match op {
            Op::AddObject {
                name,
                primitive,
                transform,
                material,
                shading,
            } => {
                if name.is_empty() {
                    return Err(Doc3dError::Invalid("object name is empty".into()));
                }
                if self.object(name).is_some() {
                    return Err(Doc3dError::DuplicateObject(name.clone()));
                }
                if self.objects.len() >= MAX_OBJECTS {
                    return Err(Doc3dError::Invalid("too many objects".into()));
                }
                if let Some(m) = material {
                    self.check_material(m)?;
                }
                let mesh = match primitive {
                    Primitive::Cube { size } => {
                        if !size.iter().all(|v| *v > 0.0 && v.is_finite()) {
                            return Err(Doc3dError::Invalid("cube size must be positive".into()));
                        }
                        PolyMesh::cube(*size)
                    }
                    Primitive::Grid { size, divisions } => PolyMesh::grid(*size, *divisions)?,
                    Primitive::QuadSphere { radius, level } => {
                        PolyMesh::quad_sphere(*radius, *level)?
                    }
                    Primitive::Geometry { geometry } => PolyMesh::from_geometry(geometry)?,
                };
                let trs = transform.to_trs();
                if !trs.is_finite() {
                    return Err(Doc3dError::Invalid("transform is not finite".into()));
                }
                report.topology = Some(mesh.topology());
                report.object = Some(name.clone());
                self.objects.push(Object3d {
                    name: name.clone(),
                    mesh,
                    transform: trs,
                    material: material.clone(),
                    shading: *shading,
                    skin: None,
                    visible: true,
                });
            }
            Op::RemoveObject { object } => {
                let i = self.index(object)?;
                self.objects.remove(i);
                report.object = Some(object.clone());
            }
            Op::SetTransform { object, transform } => {
                let i = self.index(object)?;
                let trs = transform.to_trs();
                if !trs.is_finite() {
                    return Err(Doc3dError::Invalid("transform is not finite".into()));
                }
                self.objects[i].transform = trs;
                report.object = Some(object.clone());
            }
            Op::Extrude {
                object,
                faces,
                distance,
            } => {
                let i = self.index(object)?;
                let o = &mut self.objects[i];
                let sel = faces.resolve(&o.mesh);
                report.faces = o.mesh.extrude_region(&sel, *distance)?;
                report.skin_cleared = o.skin.take().is_some();
                report.topology = Some(o.mesh.topology());
                report.object = Some(object.clone());
            }
            Op::Inset {
                object,
                faces,
                amount,
            } => {
                let i = self.index(object)?;
                let o = &mut self.objects[i];
                let sel = faces.resolve(&o.mesh);
                report.faces = o.mesh.inset_faces(&sel, *amount)?;
                report.skin_cleared = o.skin.take().is_some();
                report.topology = Some(o.mesh.topology());
                report.object = Some(object.clone());
            }
            Op::Subdivide { object, levels } => {
                if *levels == 0 || *levels > MAX_SUBDIVISION_LEVELS {
                    return Err(Doc3dError::Invalid(format!(
                        "subdivision levels must be 1..={MAX_SUBDIVISION_LEVELS}"
                    )));
                }
                let i = self.index(object)?;
                let o = &mut self.objects[i];
                for _ in 0..*levels {
                    o.mesh = o.mesh.catmull_clark()?;
                }
                report.skin_cleared = o.skin.take().is_some();
                report.topology = Some(o.mesh.topology());
                report.object = Some(object.clone());
            }
            Op::MergeByDistance { object, distance } => {
                let i = self.index(object)?;
                let o = &mut self.objects[i];
                if o.mesh.merge_by_distance(*distance) > 0 {
                    report.skin_cleared = o.skin.take().is_some();
                }
                report.topology = Some(o.mesh.topology());
                report.object = Some(object.clone());
            }
            Op::Sculpt {
                object,
                brush,
                stroke,
                rays,
            } => {
                let i = self.index(object)?;
                let o = &mut self.objects[i];
                let mut points = stroke.clone();
                for r in rays {
                    if let Some(hit) = o.mesh.raycast(r.origin, r.direction) {
                        points.push(hit.point);
                    }
                }
                if points.is_empty() {
                    return Err(Doc3dError::Invalid(
                        "sculpt stroke is empty (no points and no ray hit the surface)".into(),
                    ));
                }
                report.stroke = Some(apply_stroke(&mut o.mesh, brush, &points, None)?);
                report.object = Some(object.clone());
            }
            Op::DefineMaterial { name, material } => {
                if name.is_empty() {
                    return Err(Doc3dError::Material("material name is empty".into()));
                }
                material.to_material().map_err(Doc3dError::Material)?;
                self.materials.insert(name.clone(), material.clone());
            }
            Op::AssignMaterial { object, material } => {
                self.check_material(material)?;
                let i = self.index(object)?;
                self.objects[i].material = Some(material.clone());
                report.object = Some(object.clone());
            }
            Op::SetShading { object, shading } => {
                let i = self.index(object)?;
                self.objects[i].shading = *shading;
                report.object = Some(object.clone());
            }
            Op::AddBone {
                name,
                parent,
                transform,
                length,
            } => {
                self.skeleton
                    .add_bone(name, parent.as_deref(), transform.to_trs(), *length)?;
                // Existing bindings index the old bone set; rebinding is
                // required, so drop them rather than deform wrongly.
                for o in &mut self.objects {
                    report.skin_cleared |= o.skin.take().is_some();
                }
            }
            Op::BindSkin { object, power } => {
                let i = self.index(object)?;
                let o = &self.objects[i];
                let m = o.transform.matrix();
                let world: Vec<[f32; 3]> = o
                    .mesh
                    .positions
                    .iter()
                    .map(|p| m.transform_point(Vec3::from_array(*p)).to_array())
                    .collect();
                let weights = self.skeleton.auto_weights(&world, *power)?;
                self.objects[i].skin = Some(weights);
                report.object = Some(object.clone());
            }
            Op::AddClip { clip } => {
                let c = clip.to_clip();
                c.validate(&self.skeleton)?;
                self.clips.retain(|x| x.name != c.name);
                self.clips.push(c);
            }
        }
        Ok(report)
    }

    /// Evaluate the document into renderer nodes (world space, posed).
    ///
    /// # Errors
    /// [`Doc3dError`] for unknown clips, bad materials or rig failures.
    pub fn nodes(&self, clip: Option<&str>, time: f32) -> Result<Vec<Node3d>, Doc3dError> {
        let pose = match clip {
            Some(name) => {
                let c = self
                    .clips
                    .iter()
                    .find(|c| c.name == name)
                    .ok_or_else(|| Doc3dError::Invalid(format!("unknown clip {name:?}")))?;
                Some(c.sample(&self.skeleton, time)?)
            }
            None => None,
        };
        let matrices = match &pose {
            Some(p) => Some(self.skeleton.skin_matrices(p)?),
            None => None,
        };
        let mut nodes = Vec::new();
        for o in self.objects.iter().filter(|o| o.visible) {
            let m = o.transform.matrix();
            if affine_inverse(&m).is_none() {
                return Err(Doc3dError::Invalid(format!(
                    "object {:?} has a singular transform",
                    o.name
                )));
            }
            let mut world: Vec<[f32; 3]> = o
                .mesh
                .positions
                .iter()
                .map(|p| m.transform_point(Vec3::from_array(*p)).to_array())
                .collect();
            if let (Some(w), Some(mats)) = (&o.skin, &matrices) {
                world = skin(&world, None, w, mats)?.0;
            }
            let baked = PolyMesh {
                positions: world,
                faces: o.mesh.faces.clone(),
            };
            let material = match &o.material {
                Some(key) => self.material_def(key)?,
                None => MaterialDef::default(),
            }
            .to_material()
            .map_err(Doc3dError::Material)?;
            nodes.push(Node3d::Mesh {
                transform: Transform::IDENTITY,
                geometry: baked.to_geometry(o.shading),
                material,
            });
        }
        Ok(nodes)
    }

    /// Stage the evaluated document in the M3 studio (lights + framed
    /// camera).
    ///
    /// # Errors
    /// [`Doc3dError`] for evaluation failures or an empty document.
    pub fn scene(&self, view: &ViewSpec) -> Result<Scene3d, Doc3dError> {
        let nodes = self.nodes(view.clip.as_deref(), view.time)?;
        let background = view
            .background
            .as_deref()
            .map(parse_paint)
            .transpose()
            .map_err(Doc3dError::Invalid)?;
        let options = StudioOptions {
            seed_argb: view.seed_argb,
            is_dark: view.is_dark,
            background,
            yaw_deg: view.yaw_deg,
            pitch_deg: view.pitch_deg,
            zoom: view.zoom,
            shadows: view.shadows,
            ..StudioOptions::default()
        };
        // Frame the camera on the rest pose so animated frames share one
        // camera instead of re-framing (and jittering) every frame.
        let framing = if view.clip.is_some() {
            self.nodes(None, 0.0)?
        } else {
            nodes.clone()
        };
        let mut scene = studio_scene(framing, view.width, view.height, &options)
            .map_err(|e| Doc3dError::Render(e.to_string()))?;
        scene.nodes = nodes;
        Ok(scene)
    }

    /// Render a view on the deterministic CPU reference backend as PNG.
    ///
    /// # Errors
    /// [`Doc3dError`] for evaluation or render failures.
    pub fn render_png(&self, view: &ViewSpec) -> Result<Vec<u8>, Doc3dError> {
        crate::raster3d::render_scene3d_png(&self.scene(view)?)
            .map_err(|e| Doc3dError::Render(e.to_string()))
    }

    /// Export the evaluated (posed, world-space) document as binary glTF.
    ///
    /// # Errors
    /// [`Doc3dError`] for evaluation or export failures.
    pub fn export_glb(&self, view: &ViewSpec) -> Result<Vec<u8>, Doc3dError> {
        let scene = self.scene(view)?;
        write_glb(&scene.nodes, &scene.scheme()).map_err(|e| Doc3dError::Render(e.to_string()))
    }

    /// Summary for UIs and agents.
    #[must_use]
    pub fn stats(&self) -> DocumentStats {
        DocumentStats {
            objects: self
                .objects
                .iter()
                .map(|o| ObjectStats {
                    name: o.name.clone(),
                    topology: o.mesh.topology(),
                    volume: o.mesh.signed_volume(),
                    skinned: o.skin.is_some(),
                    material: o.material.clone(),
                })
                .collect(),
            bones: self.skeleton.bones.iter().map(|b| b.name.clone()).collect(),
            clips: self
                .clips
                .iter()
                .map(|c| (c.name.clone(), c.duration()))
                .collect(),
        }
    }
}

/// Atomic, undoable application of [`Op`]s.
#[derive(Clone, Debug, Default)]
pub struct Editor {
    /// Current document.
    pub doc: Document3d,
    undo: Vec<Document3d>,
    redo: Vec<Document3d>,
}

impl Editor {
    /// Wrap a document.
    #[must_use]
    pub fn new(doc: Document3d) -> Self {
        Self {
            doc,
            undo: Vec::new(),
            redo: Vec::new(),
        }
    }

    /// Apply an op; on error the document is unchanged.
    ///
    /// # Errors
    /// [`Doc3dError`] from the op.
    pub fn apply(&mut self, op: &Op) -> Result<OpReport, Doc3dError> {
        let mut next = self.doc.clone();
        let report = next.apply(op)?;
        let prev = std::mem::replace(&mut self.doc, next);
        self.undo.push(prev);
        if self.undo.len() > UNDO_LIMIT {
            self.undo.remove(0);
        }
        self.redo.clear();
        Ok(report)
    }

    /// Undo the last op; `false` when there is nothing to undo.
    pub fn undo(&mut self) -> bool {
        match self.undo.pop() {
            Some(prev) => {
                self.redo.push(std::mem::replace(&mut self.doc, prev));
                true
            }
            None => false,
        }
    }

    /// Redo the last undone op; `false` when there is nothing to redo.
    pub fn redo(&mut self) -> bool {
        match self.redo.pop() {
            Some(next) => {
                self.undo.push(std::mem::replace(&mut self.doc, next));
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script() -> Vec<Op> {
        serde_json::from_str(include_str!("../../examples/studio3d/character.json"))
            .map(|s: serde_json::Value| serde_json::from_value(s["ops"].clone()).unwrap())
            .unwrap()
    }

    fn built() -> Editor {
        let mut e = Editor::default();
        for op in script() {
            e.apply(&op).unwrap_or_else(|err| panic!("{op:?}: {err}"));
        }
        e
    }

    #[test]
    fn character_script_builds_a_rigged_animated_model() {
        let e = built();
        let s = e.doc.stats();
        assert_eq!(s.bones.len(), 3);
        assert_eq!(s.clips.len(), 1);
        let body = s.objects.iter().find(|o| o.name == "body").unwrap();
        assert!(body.skinned);
        assert_eq!(body.topology.boundary_edges, 0);
        assert_eq!(body.topology.non_manifold_edges, 0);
        assert!(body.volume > 0.0);
    }

    #[test]
    fn animation_deforms_the_skinned_mesh() {
        let e = built();
        let rest = e.doc.nodes(None, 0.0).unwrap();
        let posed = e.doc.nodes(Some("wave"), 0.5).unwrap();
        let pos = |n: &Node3d| match n {
            Node3d::Mesh {
                geometry: Geometry::Mesh { positions, .. },
                ..
            } => positions.clone(),
            _ => panic!("expected mesh"),
        };
        let (a, b) = (pos(&rest[0]), pos(&posed[0]));
        assert_eq!(a.len(), b.len());
        let moved = a
            .iter()
            .zip(&b)
            .filter(|(p, q)| super::super::xform::length(super::super::xform::sub(**p, **q)) > 0.02)
            .count();
        assert!(moved > 0 && moved < a.len(), "{moved}/{}", a.len());
    }

    #[test]
    fn renders_and_exports() {
        let e = built();
        let view = ViewSpec {
            width: 96,
            height: 72,
            clip: Some("wave".into()),
            time: 0.25,
            ..ViewSpec::default()
        };
        let png = e.doc.render_png(&view).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        let canvas = crate::raster3d::render_scene3d(&e.doc.scene(&view).unwrap()).unwrap();
        // Something other than the background was drawn.
        let first = &canvas.pixels[0..4];
        assert!(canvas.pixels.chunks_exact(4).any(|p| p != first));
        let glb = e.doc.export_glb(&view).unwrap();
        assert_eq!(&glb[0..4], b"glTF");
        let back =
            crate::model::parse_gltf(&glb, None, MaterialDef::default().to_material().unwrap())
                .unwrap();
        assert!(!back.is_empty());
    }

    #[test]
    fn failed_ops_are_atomic_and_undo_redo_work() {
        let mut e = Editor::default();
        e.apply(&Op::AddObject {
            name: "a".into(),
            primitive: Primitive::Cube { size: [1.0; 3] },
            transform: TransformSpec::default(),
            material: Some("gold".into()),
            shading: Shading::Flat,
        })
        .unwrap();
        let before = e.doc.clone();
        assert!(
            e.apply(&Op::Extrude {
                object: "a".into(),
                faces: FaceSelection::Indices { faces: vec![0, 99] },
                distance: 1.0,
            })
            .is_err()
        );
        assert_eq!(e.doc, before);
        assert!(
            e.apply(&Op::AssignMaterial {
                object: "a".into(),
                material: "nope".into()
            })
            .is_err()
        );
        assert!(
            e.apply(&Op::Subdivide {
                object: "a".into(),
                levels: 9
            })
            .is_err()
        );
        e.apply(&Op::Subdivide {
            object: "a".into(),
            levels: 1,
        })
        .unwrap();
        assert_eq!(e.doc.objects[0].mesh.faces.len(), 24);
        assert!(e.undo());
        assert_eq!(e.doc, before);
        assert!(e.redo());
        assert_eq!(e.doc.objects[0].mesh.faces.len(), 24);
        assert!(!e.redo());
    }

    #[test]
    fn document_roundtrips_through_json() {
        let e = built();
        let json = serde_json::to_string(&e.doc).unwrap();
        let back: Document3d = serde_json::from_str(&json).unwrap();
        assert_eq!(back.stats(), e.doc.stats());
    }
}
