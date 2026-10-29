//! Display filters for the machine picture (feature `display-filter`): scanlines, CRT, LCD grid,
//! sharp bilinear and integer scaling, chosen at runtime through the [`DisplayFilter`] resource.
//!
//! A `Material2d` quad ([`FilteredView`]) over the [`MachineScreen`] image replaces the nearest
//! sprite ([`MachineView`]) while the filter is not [`FilterKind::Off`]. The shader
//! (`display_filter.wesl`) reads the picture with `textureLoad`, so it works on every backend
//! including WebGPU, where the native slang shader path of the C cores is not available.

use crate::bevy::{
    app::{App, Plugin, Update},
    asset::{Asset, AssetApp, AssetPath, Assets, Handle, embedded_asset, embedded_path},
    camera::visibility::Visibility,
    ecs::prelude::*,
    image::Image,
    input::{ButtonInput, keyboard::KeyCode},
    math::{Vec2, Vec3, Vec4},
    mesh::{Mesh, Mesh2d},
    reflect::TypePath,
    shape::Rectangle,
    render::render_resource::AsBindGroup,
    shader::ShaderRef,
    sprite_render::{Material2d, Material2dPlugin, MeshMaterial2d},
    transform::components::Transform,
    window::{PrimaryWindow, Window},
};

use super::{MachineScreen, MachineView};

/// Which filter the picture goes through.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FilterKind {
    /// The plain nearest sprite (no material).
    #[default]
    Off,
    /// Nearest sampling through the material (integer scaling only).
    Plain,
    Scanlines,
    /// Curvature, scanlines, phosphor triads and vignette.
    Crt,
    /// Dark cell borders around each source pixel.
    Lcd,
    /// Bilinear blend confined to the texel borders.
    Sharp,
}

impl FilterKind {
    pub const ALL: [FilterKind; 6] = [
        FilterKind::Off,
        FilterKind::Plain,
        FilterKind::Scanlines,
        FilterKind::Crt,
        FilterKind::Lcd,
        FilterKind::Sharp,
    ];

    pub fn name(self) -> &'static str {
        match self {
            FilterKind::Off => "off",
            FilterKind::Plain => "plain",
            FilterKind::Scanlines => "scanlines",
            FilterKind::Crt => "crt",
            FilterKind::Lcd => "lcd",
            FilterKind::Sharp => "sharp",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|k| k.name().eq_ignore_ascii_case(name))
    }

    pub fn next(self) -> Self {
        let i = Self::ALL.iter().position(|k| *k == self).unwrap_or(0);
        Self::ALL[(i + 1) % Self::ALL.len()]
    }

    fn mode(self) -> f32 {
        match self {
            FilterKind::Off | FilterKind::Plain => 0.0,
            FilterKind::Scanlines => 1.0,
            FilterKind::Crt => 2.0,
            FilterKind::Lcd => 3.0,
            FilterKind::Sharp => 4.0,
        }
    }
}

/// The runtime selection; change it from any system.
#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct DisplayFilter {
    pub kind: FilterKind,
    /// Effect strength, 0.0 to 1.0.
    pub strength: f32,
    /// Show the picture at the largest whole multiple of its size that fits the window (the
    /// filtered view only; `Off` keeps the letterboxed sprite).
    pub integer_scale: bool,
    /// Key cycling the filters; `None` disables the shortcut.
    pub cycle_key: Option<KeyCode>,
}

impl Default for DisplayFilter {
    fn default() -> Self {
        Self {
            kind: FilterKind::Off,
            strength: 0.5,
            integer_scale: false,
            cycle_key: Some(KeyCode::F2),
        }
    }
}

/// The material over the machine picture.
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone)]
pub struct DisplayFilterMaterial {
    /// x mode, y output pixels per source pixel, z strength.
    #[uniform(0)]
    params: Vec4,
    /// xy source size in pixels.
    #[uniform(1)]
    source_size: Vec4,
    #[texture(2)]
    screen: Handle<Image>,
}

impl Material2d for DisplayFilterMaterial {
    fn fragment_shader() -> ShaderRef {
        ShaderRef::Path(
            AssetPath::from_path_buf(embedded_path!("display_filter.wesl")).with_source("embedded"),
        )
    }
}

/// Marker of the quad showing the filtered picture.
#[derive(Component, Clone, Copy, Debug, Default)]
pub struct FilteredView;

/// Adds the filter material, the quad and the runtime switching. Added by `BunEnginePlugin`.
#[derive(Default)]
pub struct DisplayFilterPlugin;

impl Plugin for DisplayFilterPlugin {
    fn build(&self, app: &mut App) {
        embedded_asset!(app, "display_filter.wesl");
        app.init_resource::<DisplayFilter>()
            .init_asset::<DisplayFilterMaterial>()
            .add_plugins(Material2dPlugin::<DisplayFilterMaterial>::default())
            .add_systems(Update, (cycle, apply).chain());
    }
}

fn cycle(keys: Option<Res<ButtonInput<KeyCode>>>, mut filter: ResMut<DisplayFilter>) {
    if let (Some(keys), Some(key)) = (keys, filter.cycle_key)
        && keys.just_pressed(key)
    {
        filter.kind = filter.kind.next();
    }
}

#[allow(clippy::too_many_arguments)]
fn apply(
    mut commands: Commands,
    filter: Res<DisplayFilter>,
    screen: Option<Res<MachineScreen>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<DisplayFilterMaterial>>,
    mut quads: Query<
        (
            Entity,
            &MeshMaterial2d<DisplayFilterMaterial>,
            &mut Transform,
            &mut Visibility,
        ),
        (With<FilteredView>, Without<MachineView>),
    >,
    mut sprites: Query<&mut Visibility, (With<MachineView>, Without<FilteredView>)>,
    windows: Query<&Window, With<PrimaryWindow>>,
) {
    let Some(screen) = screen.filter(|s| s.spawn_view) else {
        for (entity, ..) in &quads {
            commands.entity(entity).despawn();
        }
        return;
    };
    let on = filter.kind != FilterKind::Off;
    for mut visibility in &mut sprites {
        let want = if on {
            Visibility::Hidden
        } else {
            Visibility::Inherited
        };
        if *visibility != want {
            *visibility = want;
        }
    }
    let size = screen.size.as_vec2();
    // The camera scales the picture by `fit` window pixels per source pixel (AutoMin).
    let fit = windows
        .single()
        .map(|w| (w.physical_width() as f32 / size.x).min(w.physical_height() as f32 / size.y))
        .unwrap_or(1.0)
        .max(0.01);
    let pixels = if filter.integer_scale {
        fit.floor().max(1.0)
    } else {
        fit
    };
    let params = Vec4::new(filter.kind.mode(), pixels, filter.strength, 0.0);
    let source_size = Vec4::new(size.x, size.y, 0.0, 0.0);
    let scale = Vec3::new(size.x * pixels / fit, size.y * pixels / fit, 1.0);
    let mut found = false;
    for (entity, material, mut transform, mut visibility) in &mut quads {
        let stale = materials
            .get(&material.0)
            .is_none_or(|m| m.screen != screen.image);
        if stale {
            commands.entity(entity).despawn();
            continue;
        }
        found = true;
        if let Some(mut m) = materials.get_mut(&material.0)
            && (m.params != params || m.source_size != source_size)
        {
            m.params = params;
            m.source_size = source_size;
        }
        if transform.scale != scale {
            transform.scale = scale;
        }
        let want = if on {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        if *visibility != want {
            *visibility = want;
        }
    }
    if !found {
        commands.spawn((
            Mesh2d(meshes.add(Rectangle::from_size(Vec2::ONE))),
            MeshMaterial2d(materials.add(DisplayFilterMaterial {
                params,
                source_size,
                screen: screen.image.clone(),
            })),
            Transform::from_scale(scale),
            Visibility::Hidden,
            FilteredView,
        ));
    }
}
